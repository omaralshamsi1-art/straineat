/**
 * Daily insight cards built from WHOOP data + the user's plan (pure; unit-tested).
 *
 * Guidance used here and where it comes from:
 * - Protein after training: ~20–40 g (≈0.25–0.40 g/kg) of high-quality protein, ideally within ~2 h
 *   (ISSN position stands: nutrient timing, Kerksick 2017; protein and exercise, Jäger 2017).
 * - Longer / harder sessions use more glycogen, so pair that protein with carbohydrate (same ISSN stand).
 * - Caffeine even 6 h before bed cut total sleep by >1 h (Drake et al., J Clin Sleep Med 2013).
 * - Short sleep raises next-day intake by ~250–385 kcal (Al Khatib 2017; Zhu 2019 meta-analyses).
 * - Wrist devices' calorie estimates are rough — none under 20 % error (Shcherbina, Stanford 2017),
 *   so only half of any extra burn is added back to the food budget.
 * Recovery bands follow WHOOP's own: green 67–100 %, yellow 34–66 %, red 0–33 %.
 */

export const BONUS_SHARE = 0.5;
/** share once the device is calibrated against the person's own weight trend */
export const CALIBRATED_SHARE = 0.75;
export const BONUS_CAP = 1000;
export const BONUS_MIN_EXTRA = 100;

export interface BurnBonus {
  /** full-day burn expected from what was burned so far (or the final burn for a past day) */
  projectedKcal: number | null;
  /** projected burn above what the plan expects for a day */
  extraKcal: number;
  /** kcal added to today's food budget (half the extra, rounded to 10, capped; never negative) */
  bonusKcal: number;
  /** share of the extra given back: 0.5, or 0.75 once the device is calibrated */
  share: number;
}

/**
 * Extra food allowance when the device shows a bigger day than the plan expects.
 * During the day, burn so far + the plan's expected rate for the hours left = projected day.
 * Never lowers the budget (a quiet day keeps the normal target).
 */
/**
 * deviceFactor (from deviceCalibration) first corrects this person's watch bias; once the device
 * is calibrated we trust it more and give back a larger share of the extra burn.
 */
export function burnBonus(i: { burnKcal: number | null | undefined; expectedKcal: number | null | undefined; partialDay: boolean; minuteOfDay: number; deviceFactor?: number | null }): BurnBonus {
  if (i.burnKcal == null || !Number.isFinite(i.burnKcal) || !i.expectedKcal || i.expectedKcal <= 0) return { projectedKcal: null, extraKcal: 0, bonusKcal: 0, share: 0 };
  const factor = i.deviceFactor && i.deviceFactor > 0 ? i.deviceFactor : 1;
  const share = i.deviceFactor ? CALIBRATED_SHARE : BONUS_SHARE;
  const leftFrac = i.partialDay ? Math.max(0, Math.min(1440, 1440 - i.minuteOfDay)) / 1440 : 0;
  const projected = i.burnKcal * factor + i.expectedKcal * leftFrac;
  const extra = Math.max(0, projected - i.expectedKcal);
  const bonus = extra < BONUS_MIN_EXTRA ? 0 : Math.min(BONUS_CAP, Math.round((extra * share) / 10) * 10);
  return { projectedKcal: Math.round(projected), extraKcal: Math.round(extra), bonusKcal: bonus, share };
}

/** Local minute of the day (0–1439) in a time zone. */
export function localMinuteOfDay(at: Date | string, tz: string): number {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  const [h, m] = hm.split(':').map(Number);
  return (h % 24) * 60 + m;
}

export interface InsightCard {
  id: string;
  kind: 'morning' | 'workout';
  tone: 'good' | 'mid' | 'low' | 'info';
  title_ar: string;
  title_en: string;
  lines_ar: string[];
  lines_en: string[];
}

const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const hhmm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export interface WellnessDay {
  recovery?: number | null;
  sleepMin?: number | null;
  sleepNeededMin?: number | null;
  sleepStart?: string | null;
}

/** Morning plan from last night's recovery + sleep: what that means for eating today. */
export function morningCard(i: { date: string; day: WellnessDay | null | undefined; tz: string; proteinTargetG: number; ramadan: boolean }): InsightCard | null {
  const d = i.day;
  if (!d || (d.recovery == null && d.sleepMin == null)) return null;
  const rec = d.recovery != null ? Math.round(d.recovery) : null;
  const tone: InsightCard['tone'] = rec == null ? 'info' : rec >= 67 ? 'good' : rec >= 34 ? 'mid' : 'low';
  const slept = d.sleepMin != null ? hm(d.sleepMin) : null;

  const title =
    tone === 'good' ? [`جاهز ليوم قوي · استشفاء ${rec}%`, `Ready for a big day · ${rec}% recovery`]
    : tone === 'mid' ? [`يوم متوسط · استشفاء ${rec}%`, `Moderate day · ${rec}% recovery`]
    : tone === 'low' ? [`يوم خفيف · استشفاء ${rec}%`, `Take it easy · ${rec}% recovery`]
    : [`نمت ${slept} الليلة`, `You slept ${slept} last night`];

  const lines: [string, string][] = [];
  if (tone === 'good') lines.push(['مناسب لتمرين أقوى — خلّ أغلب الكارب قبل التمرين وبعده.', 'Good day for a harder session — put most of your carbs around it.']);
  if (tone === 'mid') lines.push(['تمرين معتدل يكفي اليوم، ووزّع البروتين على وجباتك.', 'A moderate session is enough today; spread your protein across meals.']);
  if (tone === 'low') lines.push(['جسمك يحتاج راحة: تمرين خفيف أو راحة، وركّز على البروتين والماي.', 'Your body needs rest: go light or rest, and focus on protein and water.']);

  const short = d.sleepMin != null && (d.sleepMin < 420 || (d.sleepNeededMin != null && d.sleepMin < d.sleepNeededMin * 0.85));
  if (short && tone !== 'info') {
    lines.push([`نمت ${slept} — قلة النوم ترفع الجوع عادة، فلا تأخّر وجباتك لين تجوع وايد.`, `You slept ${slept} — short sleep usually raises hunger, so don't wait until you're starving to eat.`]);
  } else if (short) {
    lines.push(['قلة النوم ترفع الجوع عادة، فلا تأخّر وجباتك لين تجوع وايد.', "Short sleep usually raises hunger, so don't wait until you're starving to eat."]);
  }

  if (!i.ramadan && d.sleepStart) {
    let bed = localMinuteOfDay(d.sleepStart, i.tz);
    const plausible = bed >= 19 * 60 || bed <= 4 * 60;
    if (plausible) {
      if (bed <= 4 * 60) bed += 1440;
      const cutoff = Math.floor((bed - 360) / 30) * 30;
      lines.push([`آخر قهوة قبل ${hhmm(cutoff)} — الكافيين قبل النوم بـ 6 ساعات يقصّر نومك.`, `Last coffee by ${hhmm(cutoff)} — caffeine within 6 h of bed cuts your sleep.`]);
    }
  }

  const p = Math.round(i.proteinTargetG);
  if (p > 0) {
    lines.push(
      i.ramadan
        ? [`وزّع ${p} غ بروتين بين الإفطار والسحور.`, `Split ${p} g of protein between iftar and suhoor.`]
        : [`هدف البروتين ${p} غ — حوالي 20–40 غ في كل وجبة.`, `Protein goal ${p} g — about 20–40 g per meal.`],
    );
  }

  const top = lines.slice(0, 3);
  return { id: `am:${i.date}`, kind: 'morning', tone, title_ar: title[0], title_en: title[1], lines_ar: top.map((l) => l[0]), lines_en: top.map((l) => l[1]) };
}

export interface WorkoutLike {
  id: string;
  sportAr: string;
  sportEn: string;
  end: string;
  durationMin: number;
  kcal: number | null;
  strain: number | null;
}

/** Workouts that deserve a recovery note: ≥ 20 min or ≥ 150 kcal. */
export const isNotableWorkout = (w: { durationMin: number; kcal: number | null }) => w.durationMin >= 20 || (w.kcal ?? 0) >= 150;

/** The most recent notable workout that ended within the last 3 hours (or null). */
export function recentWorkout<T extends WorkoutLike>(list: T[], now: Date, windowMin = 180): T | null {
  const t = now.getTime();
  const hits = list.filter((w) => {
    const end = Date.parse(w.end);
    return Number.isFinite(end) && end <= t && t - end <= windowMin * 60000 && isNotableWorkout(w);
  });
  return hits.sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0] ?? null;
}

/** After-workout note: protein dose for the user's weight, carbs when the session was long/hard, budget bonus. */
export function workoutCard(i: { workout: WorkoutLike; weightKg: number | null; bonusKcal: number; fasting: boolean }): InsightCard | null {
  const w = i.workout;
  if (!isNotableWorkout(w)) return null;
  const min = Math.round(w.durationMin);
  const kcal = w.kcal != null ? Math.round(w.kcal) : null;
  const dose = i.weightKg && i.weightKg > 30 ? Math.min(40, Math.max(20, Math.round((0.3 * i.weightKg) / 5) * 5)) : null;
  const pAr = dose ? `${dose} غ بروتين` : '20–40 غ بروتين';
  const pEn = dose ? `${dose} g protein` : '20–40 g protein';
  const hard = w.durationMin >= 60 || (w.strain ?? 0) >= 14 || (kcal ?? 0) >= 600;

  const lines: [string, string][] = [];
  if (i.fasting) {
    lines.push([`عند الإفطار: ${pAr}${hard ? ' مع كارب (رز، خبز، تمر)' : ''}.`, `At iftar: ${pEn}${hard ? ' with carbs (rice, bread, dates)' : ''}.`]);
  } else {
    lines.push([
      `خلال ساعتين: ${pAr}${hard ? ' مع كارب (رز، خبز، فاكهة) لأن تمرينك كان طويل أو قوي' : ' مع شوية كارب'}.`,
      `Within 2 hours: ${pEn}${hard ? ' with carbs (rice, bread, fruit) — it was a long or hard session' : ' with some carbs'}.`,
    ]);
  }
  if (i.bonusKcal > 0) lines.push([`ميزانيتك اليوم زادت +${i.bonusKcal} سعرة بسبب حرقك الإضافي.`, `Today's budget went up +${i.bonusKcal} kcal for the extra burn.`]);
  const ml = Math.min(1500, Math.max(250, Math.round((min / 60) * 500 / 50) * 50));
  lines.push(i.fasting
    ? [`بعد الإفطار اشرب ~${ml} مل زيادة على دفعات لتعويض العرق (أُضيفت لهدف الماء).`, `After iftar drink ~${ml} ml extra in rounds to replace sweat (added to your water goal).`]
    : [`اشرب ~${ml} مل زيادة على دفعات لتعويض العرق (أُضيفت لهدف الماء).`, `Drink ~${ml} ml extra in rounds to replace sweat (added to your water goal).`]);

  return {
    id: `wo:${w.id}`,
    kind: 'workout',
    tone: 'info',
    title_ar: `خلصت ${w.sportAr} · ${min} د${kcal != null ? ` · ${kcal} سعرة` : ''}`,
    title_en: `Done: ${w.sportEn} · ${min} min${kcal != null ? ` · ${kcal} kcal` : ''}`,
    lines_ar: lines.map((l) => l[0]),
    lines_en: lines.map((l) => l[1]),
  };
}

/** Cards for today, most urgent first: a fresh workout, then the morning plan (until 15:00). */
export function todayCards(i: {
  date: string;
  now: Date;
  tz: string;
  wellness: WellnessDay | null | undefined;
  workouts: WorkoutLike[];
  weightKg: number | null;
  proteinTargetG: number;
  bonusKcal: number;
  ramadan: boolean;
  fasting: boolean;
}): InsightCard[] {
  const out: InsightCard[] = [];
  const w = recentWorkout(i.workouts, i.now);
  const wc = w ? workoutCard({ workout: w, weightKg: i.weightKg, bonusKcal: i.bonusKcal, fasting: i.fasting }) : null;
  if (wc) out.push(wc);
  if (localMinuteOfDay(i.now, i.tz) < 15 * 60) {
    const mc = morningCard({ date: i.date, day: i.wellness, tz: i.tz, proteinTargetG: i.proteinTargetG, ramadan: i.ramadan });
    if (mc) out.push(mc);
  }
  return out;
}
