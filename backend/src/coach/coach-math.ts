import { Nutrients } from '../common/types';

export interface MealScore {
  score: number; // 0–10
  grade: 'excellent' | 'good' | 'ok' | 'poor';
  label_ar: string;
  label_en: string;
  reasons: { good: boolean; text_ar: string; text_en: string }[];
}

/**
 * Transparent, rule-based meal score (no AI) so the same meal always gets the same score.
 *  protein density 0–3, fibre 0–2, added-sugar share 0–2, sodium 0–1, fit in today's budget 0–2.
 * For weight gain the budget rule rewards meals that move the user toward the target.
 */
export function scoreMeal(n: Nutrients, ctx: { goal: 'lose' | 'maintain' | 'gain'; remainingBeforeKcal: number; dailyTargetKcal: number }): MealScore {
  const reasons: MealScore['reasons'] = [];
  const kcal = Math.max(1, n.calories);
  let s = 0;

  const pShare = (n.protein_g * 4) / kcal;
  if (pShare >= 0.25) { s += 3; reasons.push({ good: true, text_ar: 'غنية بالبروتين', text_en: 'High in protein' }); }
  else if (pShare >= 0.15) { s += 2; reasons.push({ good: true, text_ar: 'بروتين جيد', text_en: 'Good protein' }); }
  else if (pShare >= 0.1) { s += 1; reasons.push({ good: false, text_ar: 'بروتين متوسط', text_en: 'Moderate protein' }); }
  else reasons.push({ good: false, text_ar: 'بروتين قليل', text_en: 'Low protein' });

  const fiberPer1000 = (n.fiber_g / kcal) * 1000;
  if (fiberPer1000 >= 14) { s += 2; reasons.push({ good: true, text_ar: 'ألياف ممتازة', text_en: 'Excellent fibre' }); }
  else if (fiberPer1000 >= 7) { s += 1; }
  else reasons.push({ good: false, text_ar: 'ألياف قليلة', text_en: 'Low fibre' });

  const sugarShare = (n.sugar_g * 4) / kcal;
  if (sugarShare <= 0.1) s += 2;
  else if (sugarShare <= 0.2) { s += 1; reasons.push({ good: false, text_ar: 'سكر متوسط', text_en: 'Moderate sugar' }); }
  else reasons.push({ good: false, text_ar: 'سكر مرتفع', text_en: 'High sugar' });

  if (n.sodium_mg <= 800) s += 1;
  else if (n.sodium_mg > 1500) reasons.push({ good: false, text_ar: 'ملح مرتفع', text_en: 'High salt' });

  if (ctx.goal === 'gain') {
    // reward meaningful, not excessive, contributions toward a surplus
    const share = n.calories / Math.max(1, ctx.dailyTargetKcal);
    if (share >= 0.2 && n.calories <= ctx.remainingBeforeKcal + 300) { s += 2; reasons.push({ good: true, text_ar: 'تقرّبك من هدف الزيادة', text_en: 'Moves you toward your gain goal' }); }
    else if (share >= 0.12) s += 1;
    else reasons.push({ good: false, text_ar: 'كمية صغيرة لهدف الزيادة', text_en: 'Small portion for a gain goal' });
  } else {
    if (n.calories <= ctx.remainingBeforeKcal) { s += 2; reasons.push({ good: true, text_ar: 'ضمن ميزانية اليوم', text_en: "Within today's budget" }); }
    else if (n.calories <= ctx.remainingBeforeKcal + 200) { s += 1; reasons.push({ good: false, text_ar: 'تتجاوز ميزانية اليوم قليلاً', text_en: "Slightly over today's budget" }); }
    else reasons.push({ good: false, text_ar: 'تتجاوز ميزانية اليوم', text_en: "Over today's budget" });
  }

  const score = Math.max(0, Math.min(10, s));
  const grade = score >= 8 ? 'excellent' : score >= 6 ? 'good' : score >= 4 ? 'ok' : 'poor';
  const label_ar = { excellent: 'اختيار ممتاز', good: 'اختيار جيد', ok: 'مقبول', poor: 'يحتاج تحسين' }[grade];
  const label_en = { excellent: 'Excellent choice', good: 'Good choice', ok: 'OK', poor: 'Needs work' }[grade];
  return { score, grade, label_ar, label_en, reasons: reasons.slice(0, 4) };
}

// ---------------------------------------------------------------- Ramadan

/** Hijri month (Umm al-Qura calendar) of a date in a timezone; 9 = Ramadan. */
export function hijriMonth(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone, month: 'numeric' })
    .formatToParts(at)
    .find((p) => p.type === 'month');
  return Number(part?.value ?? 0);
}

export function isRamadan(at: Date, timeZone: string): boolean {
  return hijriMonth(at, timeZone) === 9;
}

/** Hijri month + day (Umm al-Qura) in a timezone. */
export function hijriDate(at: Date, timeZone: string): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { month: get('month'), day: get('day') };
}

/** Days voluntary fasting is not done: Eid al-Fitr (1 Shawwal), Eid al-Adha and Tashreeq (10–13 Dhu al-Hijjah). */
export function isNoFastDay(h: { month: number; day: number }): boolean {
  return (h.month === 10 && h.day === 1) || (h.month === 12 && h.day >= 10 && h.day <= 13);
}

/** Local weekday 0 = Sunday … 6 = Saturday. */
export function localWeekday(at: Date, timeZone: string): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

/** Is today a chosen voluntary fasting day (outside Ramadan)? */
export function voluntaryFastToday(st: { fastDays?: number[]; whiteDays?: boolean } | undefined, at: Date, timeZone: string): 'weekday' | 'white' | null {
  if (!st) return null;
  const h = hijriDate(at, timeZone);
  if (h.month === 9 || isNoFastDay(h)) return null;
  if ((st.fastDays ?? []).includes(localWeekday(at, timeZone))) return 'weekday';
  if (st.whiteDays && h.day >= 13 && h.day <= 15) return 'white';
  return null;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export interface RamadanView {
  active: boolean; // Ramadan (unless turned off), always-on, or a chosen voluntary fasting day
  /** why today is a fasting day */
  kind: 'ramadan' | 'manual' | 'weekday' | 'white' | null;
  detected: boolean; // calendar says Ramadan
  needsChoice: boolean; // Ramadan detected and the user has not decided yet
  fasting: boolean; // between suhoor and iftar right now
  suhoorTime: string;
  iftarTime: string;
  split: { suhoor: number; iftar: number; evening: number } | null; // kcal
  minutesToIftar: number | null;
}

/** Suhoor ≈30%, iftar ≈45%, evening snack/second meal ≈25% of the daily target. */
export function ramadanView(
  setting: { enabled: boolean | null; suhoorTime: string; iftarTime: string; fastDays?: number[]; whiteDays?: boolean } | undefined,
  now: Date,
  timeZone: string,
  targetKcal: number,
): RamadanView {
  const st = setting ?? { enabled: null, suhoorTime: '04:45', iftarTime: '18:00' };
  const detected = isRamadan(now, timeZone);
  // On automatically during Ramadan unless the user turned it off; the user may also turn it on for voluntary fasting days.
  const ramadanOn = detected && st.enabled !== false;
  const voluntary = detected ? null : voluntaryFastToday(st, now, timeZone);
  const active = st.enabled === true || ramadanOn || !!voluntary;
  const kind: RamadanView['kind'] = ramadanOn ? 'ramadan' : st.enabled === true ? 'manual' : voluntary;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const nowMin = toMin(hm);
  const s = toMin(st.suhoorTime), i = toMin(st.iftarTime);
  const fasting = active && nowMin >= s && nowMin < i;
  const r = (x: number) => Math.round(x / 10) * 10;
  return {
    active,
    kind: active ? kind : null,
    detected,
    needsChoice: detected && st.enabled === null,
    fasting,
    suhoorTime: st.suhoorTime,
    iftarTime: st.iftarTime,
    split: active ? { suhoor: r(targetKcal * 0.3), iftar: r(targetKcal * 0.45), evening: r(targetKcal * 0.25) } : null,
    minutesToIftar: fasting ? i - nowMin : null,
  };
}

/** Ramadan-specific nudges (shown instead of regular timing-based tips). */
export function ramadanTips(v: RamadanView, intakeKcal: number): { kind: string; text_ar: string; text_en: string }[] {
  if (!v.active) return [];
  if (v.fasting) {
    const h = Math.floor((v.minutesToIftar ?? 0) / 60), m = (v.minutesToIftar ?? 0) % 60;
    return [{
      kind: 'ramadan',
      text_ar: `${v.kind === 'ramadan' ? 'صياماً مقبولاً 🌙' : 'صيام مقبول اليوم 🌙'} — باقي على الإفطار ${h ? `${h} ساعة ` : ''}${m} دقيقة. ابدأ الإفطار بالتمر والماء، ثم شوربة أو سلطة قبل الطبق الرئيسي.`,
      text_en: `${v.kind === 'ramadan' ? 'Ramadan Kareem 🌙' : 'Fasting today 🌙'} — ${h ? `${h} h ` : ''}${m} min to iftar. Break your fast with dates and water, then soup or salad before the main dish.`,
    }];
  }
  const tips = [{ kind: 'ramadan', text_ar: 'وزّع هدف الماء بين الإفطار والسحور على دفعات، وقلّل المقليات والحلويات الثقيلة.', text_en: 'Spread your water goal between iftar and suhoor in rounds, and go easy on fried food and heavy sweets.' }];
  if (intakeKcal > 0 && v.split && intakeKcal < v.split.iftar + v.split.evening) {
    tips.push({
      kind: 'suhoor',
      text_ar: `لا تنسَ السحور (حوالي ${v.split.suhoor} سعرة): بروتين بطيء الهضم كالبيض أو اللبن مع الشوفان أو الخبز الأسمر.`,
      text_en: `Don't skip suhoor (about ${v.split.suhoor} kcal): slow protein like eggs or yoghurt with oats or wholegrain bread.`,
    });
  }
  return tips;
}
