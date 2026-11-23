/**
 * Goal engine — pure functions (no I/O) so every rule is unit-tested.
 *
 * Evidence used for the defaults:
 *  - Loss pace: ~0.5–1 kg (1–2 lb) per week is the commonly recommended sustainable rate (CDC).
 *    We express pace as % of body weight per week and cap it at 1 kg/week.
 *  - Calorie floor: AHA/ACC/TOS adult guideline prescribes 1200–1500 kcal/d (women) and
 *    1500–1800 kcal/d (men) for weight-loss diets — we never set targets below the lower bound,
 *    nor below estimated BMR.
 *  - Protein: ISSN position stand — 1.4–2.0 g/kg/day for exercising individuals.
 *  - Fibre: ~14 g per 1000 kcal (Dietary Guidelines for Americans).
 *  - Energy density of body-mass change: ~7700 kcal per kg (≈3500 kcal/lb rule of thumb).
 */

export type Goal = 'lose' | 'maintain' | 'gain';
export type Pace = 'relaxed' | 'moderate' | 'fast' | 'intense';
export type Sex = 'male' | 'female' | null;

export const KCAL_PER_KG = 7700;

/** Weekly change as a fraction of body weight. */
export const PACE_RATE: Record<'lose' | 'gain', Record<Pace, number>> = {
  lose: { relaxed: 0.0025, moderate: 0.005, fast: 0.0075, intense: 0.01 },
  gain: { relaxed: 0.00125, moderate: 0.0025, fast: 0.004, intense: 0.005 },
};
const MAX_LOSS_KG_WEEK = 1.0;
/**
 * Intense loss (above 0.75% of body weight a week) is offered only with BMI ≥ 25, age 18–64 and no
 * condition that needs a clinician. It stays under ~1.36 kg (3 lb) a week — the rate above which
 * NIDDK reports a higher gallstone risk — and never goes under the calorie floor, so it is never a
 * very-low-calorie diet (≤800 kcal, medical supervision only — NHS).
 */
const INTENSE_MAX_KG_WEEK = 1.25;
const INTENSE_MAX_DEFICIT = 1300;
const MAX_GAIN_KG_WEEK = 0.5;
const MAX_DEFICIT = 1000;
const MAX_SURPLUS = 500;

export interface Screening {
  pregnant?: boolean;
  breastfeeding?: boolean;
  /** user says a clinician should guide their diet (diabetes on insulin, kidney disease, etc.) */
  medicalSupervision?: boolean;
  /** user reports a history of disordered eating */
  edHistory?: boolean;
}

export interface PlanInput {
  goal: Goal;
  pace: Pace;
  sex: Sex;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null; // current (trend) weight
  targetWeightKg: number | null;
  maintenanceKcal: number; // best TDEE estimate
  maintenanceSource: 'adaptive' | 'device' | 'formula';
  bmr: number | null;
  screening: Screening;
  /** optional deadline (YYYY-MM-DD) for targetWeightKg */
  targetDate?: string | null;
  today?: Date;
}

export type Advice = { text_ar: string; text_en: string };

export interface Plan {
  goal: Goal;
  effectiveGoal: Goal; // after safety rules
  pace: Pace;
  maintenanceKcal: number;
  maintenanceSource: PlanInput['maintenanceSource'];
  dailyDeltaKcal: number;
  targetKcal: number;
  floorKcal: number;
  limitedByFloor: boolean;
  weeklyChangeKg: number; // negative = loss
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  bmi: number | null;
  targetBmi: number | null;
  etaDate: string | null;
  weeksToGoal: number | null;
  /** loss above 0.75% of body weight a week */
  intense: boolean;
  /** fastest weekly change the plan allows for this person (kg, positive) */
  maxSafeKgWeek: number | null;
  deadline: { date: string; requiredKgWeek: number; feasible: boolean } | null;
  /** what to know and do on an intense plan */
  advice: Advice[];
  notices: { level: 'info' | 'warn' | 'stop'; code: string; text_ar: string; text_en: string }[];
}

const r = (n: number, step = 1) => Math.round(n / step) * step;

export function bmiOf(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function calorieFloor(sex: Sex, bmr: number | null): number {
  const sexFloor = sex === 'male' ? 1500 : sex === 'female' ? 1200 : 1400;
  return Math.max(sexFloor, bmr ? r(bmr, 10) : 0);
}

export function computePlan(i: PlanInput): Plan {
  const notices: Plan['notices'] = [];
  const bmi = bmiOf(i.weightKg, i.heightCm);
  const targetBmi = bmiOf(i.targetWeightKg, i.heightCm);
  let goal: Goal = i.goal;

  // ---- safety rules: when any applies we do not prescribe a deficit or surplus ----
  const s = i.screening ?? {};
  if (i.age != null && i.age < 18) {
    notices.push({ level: 'stop', code: 'under18', text_ar: 'لمن هم دون 18 سنة نعرض أرقاماً للمتابعة فقط بدون هدف إنقاص أو زيادة. استشر طبيب الأطفال أو أخصائي تغذية.', text_en: 'Under 18 we only show numbers for tracking, with no loss or gain target. Please talk to a paediatrician or dietitian.' });
    goal = 'maintain';
  }
  if (s.pregnant || s.breastfeeding) {
    notices.push({ level: 'stop', code: 'pregnancy', text_ar: 'أثناء الحمل أو الرضاعة لا يضع التطبيق عجزاً في السعرات. احتياجك يحدده طبيبك.', text_en: 'During pregnancy or breastfeeding the app never sets a calorie deficit. Your doctor decides what you need.' });
    goal = 'maintain';
  }
  if (s.edHistory) {
    notices.push({ level: 'stop', code: 'ed', text_ar: 'لسلامتك لن نضع هدفاً لإنقاص الوزن. يمكنك استخدام التطبيق للمتابعة، ونشجعك على العمل مع مختص.', text_en: "For your safety we won't set a weight-loss target. You can still use the app for tracking, and we encourage working with a specialist." });
    if (goal === 'lose') goal = 'maintain';
  }
  if (s.medicalSupervision) {
    notices.push({ level: 'warn', code: 'medical', text_ar: 'لديك حالة صحية تحتاج إشرافاً: راجع طبيبك قبل تغيير نظامك الغذائي، والأرقام هنا إرشادية.', text_en: 'You have a condition that needs supervision: check with your doctor before changing your diet. These numbers are a guide only.' });
  }
  if (goal === 'lose' && bmi != null && bmi < 18.5) {
    notices.push({ level: 'stop', code: 'underweight', text_ar: 'مؤشر كتلة جسمك أقل من 18.5، لذلك لا ننصح بإنقاص الوزن. حوّلنا هدفك إلى المحافظة.', text_en: "Your BMI is below 18.5, so we don't recommend losing weight. We've switched your goal to maintain." });
    goal = 'maintain';
  }
  if (goal === 'lose' && targetBmi != null && targetBmi < 18.5) {
    notices.push({ level: 'warn', code: 'target_low', text_ar: 'الوزن المستهدف يجعل مؤشر كتلة الجسم أقل من 18.5. ننصح بهدف أعلى.', text_en: 'That target weight puts your BMI below 18.5. We recommend a higher target.' });
  }
  if (goal === 'lose' && i.targetWeightKg && i.weightKg && i.targetWeightKg >= i.weightKg) {
    notices.push({ level: 'info', code: 'target_reached', text_ar: 'وصلت إلى وزنك المستهدف 🎉 — حان وقت المحافظة.', text_en: "You've reached your target weight 🎉 — time to maintain." });
    goal = 'maintain';
  }
  if (goal === 'gain' && i.targetWeightKg && i.weightKg && i.targetWeightKg <= i.weightKg) {
    notices.push({ level: 'info', code: 'target_reached', text_ar: 'وصلت إلى وزنك المستهدف 🎉 — حان وقت المحافظة.', text_en: "You've reached your target weight 🎉 — time to maintain." });
    goal = 'maintain';
  }

  // ---- energy target ----
  const floor = calorieFloor(i.sex, i.bmr);
  const age = i.age;
  const intenseBlock = goal !== 'lose' ? null
    : bmi == null ? 'no_bmi'
    : bmi < 25 ? 'bmi'
    : age != null && age >= 65 ? 'age'
    : s.medicalSupervision ? 'medical'
    : null;
  let delta = 0;
  let weekly = 0;
  let maxSafe: number | null = null;
  let deadline: Plan['deadline'] = null;
  if (goal !== 'maintain' && i.weightKg) {
    maxSafe = goal === 'lose'
      ? (intenseBlock ? Math.min(PACE_RATE.lose.fast * i.weightKg, MAX_LOSS_KG_WEEK) : Math.min(PACE_RATE.lose.intense * i.weightKg, INTENSE_MAX_KG_WEEK))
      : Math.min(PACE_RATE.gain.intense * i.weightKg, MAX_GAIN_KG_WEEK);
    let rate = PACE_RATE[goal][i.pace] * i.weightKg; // kg/week
    const days = i.targetDate ? Math.round((Date.parse(`${i.targetDate}T12:00:00Z`) - Date.parse(`${(i.today ?? new Date()).toISOString().slice(0, 10)}T12:00:00Z`)) / 86400000) : null;
    if (i.targetDate && i.targetWeightKg && days != null) {
      const required = Math.abs(i.targetWeightKg - i.weightKg) / Math.max(days / 7, 1 / 7);
      if (days < 7) {
        notices.push({ level: 'warn', code: 'deadline_close', text_ar: 'تاريخ هدفك قريب جداً (أقل من أسبوع) — حدّث التاريخ لنحسب خطة واقعية. نستخدم الآن السرعة المختارة.', text_en: 'Your target date is less than a week away — update it so we can plan realistically. Using your chosen pace for now.' });
      } else {
        rate = Math.min(required, maxSafe);
        deadline = { date: i.targetDate, requiredKgWeek: Math.round(required * 100) / 100, feasible: required <= maxSafe + 1e-9 };
      }
    } else if (i.pace === 'intense' && goal === 'lose' && intenseBlock) {
      const why: Record<string, [string, string]> = {
        no_bmi: ['نحتاج طولك ووزنك أولاً', 'we need your height and weight first'],
        bmi: ['مؤشر كتلة جسمك أقل من 25، وعندها يكون جزء أكبر من النزول السريع عضلاً', 'your BMI is under 25, where more of a fast loss comes from muscle'],
        age: ['بعد سن 65 يحتاج النزول السريع متابعة طبية', 'after 65 fast loss needs medical follow-up'],
        medical: ['عندك حالة صحية تحتاج إشراف طبيب', 'you have a condition that needs a doctor’s supervision'],
      };
      notices.push({ level: 'info', code: 'intense_unavailable', text_ar: `السرعة المكثفة غير متاحة لك لأن ${why[intenseBlock][0]}، فاستخدمنا «أسرع» بدلاً منها.`, text_en: `The intense pace isn't available because ${why[intenseBlock][1]}, so we used "Faster" instead.` });
    }
    const capped = Math.min(rate, maxSafe);
    const intenseRate = goal === 'lose' && capped > PACE_RATE.lose.fast * i.weightKg + 1e-6;
    delta = (capped * KCAL_PER_KG) / 7;
    delta = goal === 'lose'
      ? -Math.min(delta, intenseRate ? INTENSE_MAX_DEFICIT : MAX_DEFICIT, (intenseRate ? 0.35 : 0.25) * i.maintenanceKcal)
      : Math.min(delta, MAX_SURPLUS);
  } else if (goal !== 'maintain') {
    delta = goal === 'lose' ? -400 : 250; // no weight known yet: conservative default
  }
  let target = i.maintenanceKcal + delta;
  let limitedByFloor = false;
  if (target < floor) {
    target = floor;
    limitedByFloor = goal === 'lose';
    if (limitedByFloor) {
      notices.push({ level: 'info', code: 'floor', text_ar: `هدفك محدود بحد أدنى آمن (${floor} سعرة)، لذلك سيكون التقدم أبطأ قليلاً.`, text_en: `Your target is held at a safe minimum (${floor} kcal), so progress will be a little slower.` });
    }
  }
  target = r(target, 10);
  delta = target - i.maintenanceKcal;
  weekly = Math.round(((delta * 7) / KCAL_PER_KG) * 100) / 100;
  const intense = goal === 'lose' && !!i.weightKg && -weekly > PACE_RATE.lose.fast * i.weightKg + 0.01;
  if (!intense && i.pace === 'intense' && goal === 'lose' && !intenseBlock && !deadline && i.weightKg) {
    notices.push({ level: 'info', code: 'intense_unavailable', text_ar: `أسرع نزول آمن لك ${Math.abs(weekly)} كغ أسبوعياً، لأن هدفك ما ينزل تحت ${floor} سعرة (حرقك الأساسي)، فالمكثّف ما يضيف لك شي.`, text_en: `Your fastest safe loss is ${Math.abs(weekly)} kg a week because your target never goes under ${floor} kcal (your resting burn), so intense adds nothing for you.` });
  }

  // ---- macros ----
  const w = i.weightKg ?? 70;
  // For higher BMI, base protein on a reference weight (BMI 25) to avoid inflated targets.
  const refW = bmi && bmi > 30 && i.heightCm ? 25 * (i.heightCm / 100) ** 2 : w;
  // ISSN 1.4–2.0 g/kg; in a big deficit ~2.2–2.4 g/kg kept more lean mass in trials (Mettler 2010, Longland 2016)
  const proteinPerKg = goal === 'maintain' ? 1.4 : intense ? 2.2 : 1.8;
  const proteinG = r(refW * proteinPerKg, 5);
  const fatG = Math.max(r((target * 0.28) / 9, 5), r(w * 0.6, 5));
  const carbsG = Math.max(0, r((target - proteinG * 4 - fatG * 9) / 4, 5));
  const fiberG = r((target / 1000) * 14);

  // ---- ETA ----
  let weeksToGoal: number | null = null;
  let etaDate: string | null = null;
  if (goal !== 'maintain' && i.weightKg && i.targetWeightKg && weekly !== 0) {
    const weeks = (i.targetWeightKg - i.weightKg) / weekly;
    if (weeks > 0 && Number.isFinite(weeks)) {
      weeksToGoal = Math.ceil(weeks);
      const d = new Date(i.today ?? new Date());
      d.setDate(d.getDate() + Math.round(weeks * 7));
      etaDate = d.toISOString().slice(0, 10);
    }
  }

  // ---- deadline + intense advice ----
  if (deadline) {
    const kg = (n: number) => (Math.round(n * 100) / 100).toString();
    if (deadline.feasible) {
      notices.push({ level: 'info', code: 'deadline_ok', text_ar: `للوصول إلى ${i.targetWeightKg} كغ بتاريخ ${deadline.date} تحتاج ${kg(deadline.requiredKgWeek)} كغ أسبوعياً — خطتك محسوبة على هذا.`, text_en: `To reach ${i.targetWeightKg} kg by ${deadline.date} you need ${kg(deadline.requiredKgWeek)} kg a week — your plan is set for that.` });
    } else {
      notices.push({ level: 'warn', code: 'deadline_unrealistic', text_ar: `تاريخ ${deadline.date} يحتاج ${kg(deadline.requiredKgWeek)} كغ أسبوعياً، وهذا فوق الحد الآمن لك (${kg(maxSafe ?? 0)} كغ). خطتك على أسرع سرعة آمنة${etaDate ? `، والتاريخ المتوقع ${etaDate}` : ''}.`, text_en: `${deadline.date} needs ${kg(deadline.requiredKgWeek)} kg a week, above your safe limit (${kg(maxSafe ?? 0)} kg). Your plan uses the fastest safe pace${etaDate ? `; expected date ${etaDate}` : ''}.` });
    }
  }
  const advice: Advice[] = [];
  if (intense) {
    notices.push({ level: 'warn', code: 'intense', text_ar: `خطة نزول مكثف (~${Math.abs(weekly)} كغ أسبوعياً). ممكنة لفترة محدودة، اقرأ النصائح تحت.`, text_en: `Intense loss plan (~${Math.abs(weekly)} kg a week). Fine for a limited time — read the advice below.` });
    advice.push(
      { text_ar: 'النزول أكثر من ~1.4 كغ أسبوعياً يرفع خطر حصى المرارة، لذلك نوقف السرعة تحت هذا الحد.', text_en: 'Losing more than ~1.4 kg (3 lb) a week raises the risk of gallstones, so we keep the pace below that.' },
      { text_ar: `في العجز الكبير جزء من النزول يكون عضلاً: رفعنا بروتينك إلى ${proteinG} غ يومياً، وسوّ تمارين مقاومة 2–3 مرات أسبوعياً.`, text_en: `In a big deficit part of the loss can be muscle: we raised your protein to ${proteinG} g a day — do resistance training 2–3 times a week.` },
      { text_ar: 'توقع جوع وتعب أكثر وتراجع في أداء التمرين والنوم. اشرب ماء كافي وخل الخضار والألياف في كل وجبة.', text_en: 'Expect more hunger and tiredness and weaker training and sleep. Drink enough water and add vegetables and fibre to every meal.' },
      { text_ar: `هدفك لن ينزل تحت ${floor} سعرة. الحميات تحت 800 سعرة تكون فقط بإشراف طبي.`, text_en: `Your target never goes under ${floor} kcal. Diets under 800 kcal are for medical supervision only.` },
      { text_ar: 'خلها مرحلة مؤقتة (8–12 أسبوعاً) ثم أسبوعين محافظة؛ النزول السريع بدون مرحلة تثبيت يرجع غالباً.', text_en: 'Keep it a phase (8–12 weeks), then two weeks at maintenance; fast loss without a maintenance phase often comes back.' },
      { text_ar: 'وقف وراجع الطبيب إذا صارت دوخة مستمرة، خفقان، ألم أعلى يمين البطن، أو انقطاع الدورة.', text_en: 'Stop and see a doctor if you get lasting dizziness, palpitations, pain under the right ribs, or missed periods.' },
    );
  }

  return {
    goal: i.goal,
    effectiveGoal: goal,
    pace: i.pace,
    maintenanceKcal: r(i.maintenanceKcal, 10),
    maintenanceSource: i.maintenanceSource,
    dailyDeltaKcal: delta,
    targetKcal: target,
    floorKcal: floor,
    limitedByFloor,
    weeklyChangeKg: weekly,
    proteinG,
    fatG,
    carbsG,
    fiberG,
    bmi,
    targetBmi,
    etaDate,
    weeksToGoal,
    intense,
    maxSafeKgWeek: maxSafe == null ? null : Math.round(maxSafe * 100) / 100,
    deadline,
    advice,
    notices,
  };
}

/** Exponentially-weighted trend of daily weights (smooths water/food noise). */
export function weightTrend(points: { date: string; kg: number }[], alpha = 0.1): { date: string; kg: number; trend: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let t: number | null = null;
  let prevDate: string | null = null;
  return sorted.map((p) => {
    if (t == null) t = p.kg;
    else {
      // account for gaps: apply the smoothing once per elapsed day
      const gap = prevDate ? Math.max(1, Math.round((Date.parse(p.date) - Date.parse(prevDate)) / 86400000)) : 1;
      const a = 1 - Math.pow(1 - alpha, gap);
      t = t + a * (p.kg - t);
    }
    prevDate = p.date;
    return { date: p.date, kg: p.kg, trend: Math.round(t * 100) / 100 };
  });
}

/**
 * Adaptive maintenance: what the body actually burned = average intake − stored energy change.
 * Needs ≥10 logged days and a weight trend spanning ≥10 days; blended with the baseline and clamped.
 */
export function adaptiveMaintenance(opts: {
  baseline: number;
  loggedDays: { date: string; kcal: number }[];
  trend: { date: string; trend: number }[];
}): { kcal: number; adaptive: boolean; observed: number | null } {
  const days = opts.loggedDays.filter((d) => d.kcal >= 600); // skip clearly incomplete days
  if (days.length < 10 || opts.trend.length < 2) return { kcal: opts.baseline, adaptive: false, observed: null };
  const first = opts.trend[0];
  const last = opts.trend[opts.trend.length - 1];
  const span = (Date.parse(last.date) - Date.parse(first.date)) / 86400000;
  if (span < 10) return { kcal: opts.baseline, adaptive: false, observed: null };
  const avgIntake = days.reduce((a, d) => a + d.kcal, 0) / days.length;
  const observed = avgIntake - ((last.trend - first.trend) * KCAL_PER_KG) / span;
  const clamped = Math.min(opts.baseline * 1.35, Math.max(opts.baseline * 0.7, observed));
  const w = Math.min(1, days.length / 21) * 0.7;
  return { kcal: Math.round(opts.baseline * (1 - w) + clamped * w), adaptive: true, observed: Math.round(observed) };
}

export const ACTIVITY_LEVELS = [
  ['sedentary', 1.2],
  ['light', 1.375],
  ['moderate', 1.55],
  ['active', 1.725],
  ['very_active', 1.9],
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number][0];

/** Minimum complete device days before measured burn replaces the formula; window averaged. */
export const CALIBRATION_MIN_DAYS = 7;
export const CALIBRATION_WINDOW_DAYS = 14;

/**
 * Given the measured average daily burn and BMR, return the activity level whose multiplier is
 * closest to burn / BMR. Returns null when the current level already fits (within half a step).
 */
export function calibrateActivity(current: ActivityLevel, avgBurn: number, bmr: number | null):
  { to: ActivityLevel; factor: number } | null {
  if (!bmr || bmr <= 0 || !avgBurn) return null;
  const factor = Math.round((avgBurn / bmr) * 1000) / 1000;
  let best: ActivityLevel = 'sedentary';
  let bestDiff = Infinity;
  for (const [lvl, f] of ACTIVITY_LEVELS) {
    const d = Math.abs(factor - f);
    if (d < bestDiff) { bestDiff = d; best = lvl; }
  }
  return best === current ? null : { to: best, factor };
}
