import { MealItem, Profile } from '../common/types';

/**
 * Daily drinking target (beverages, ml). Evidence:
 *  - NASEM/IOM adequate intake for total water: 3.7 L men / 2.7 L women, ~80% from drinks
 *    → 3.0 L / 2.2 L from beverages; pregnancy 2.3 L, breastfeeding 3.1 L from beverages.
 *  - Needs rise with activity and heat (IOM: very active people in hot weather can need 6 L+).
 *  - Kidney or heart disease may need a fluid limit set by a doctor → no target, tracking only.
 *  - Very large intakes, especially fast, can cause hyponatremia → warnings.
 */
export const BASE_ML = { male: 3000, female: 2200, unknown: 2600 } as const;
export const PREGNANT_ML = 2300;
export const BREASTFEEDING_ML = 3100;
export const ML_PER_WORKOUT_HOUR = 500;
export const MAX_WORKOUT_ML = 1500;
export const HEAT_ML = 750;
export const DAILY_WARN_ML = 6000;
export const HOURLY_WARN_ML = 1500;
/** drinking is spread over waking hours; "on track" compares with this window */
export const DAY_START_MIN = 8 * 60;
export const DAY_END_MIN = 22 * 60;

export type WaterTarget = {
  targetMl: number | null;
  baseMl: number;
  workoutMl: number;
  heatMl: number;
  /** kidney / heart: the doctor sets fluid limits */
  supervised: boolean;
};

const r50 = (n: number) => Math.round(n / 50) * 50;

export function waterTarget(p: Pick<Profile, 'sex' | 'conditions' | 'screening' | 'hotEnvironment'>, workoutMin: number): WaterTarget {
  const supervised = (p.conditions ?? []).some((c) => c === 'kidney' || c === 'heart');
  let base: number = p.sex === 'male' ? BASE_ML.male : p.sex === 'female' ? BASE_ML.female : BASE_ML.unknown;
  if (p.screening?.breastfeeding) base = BREASTFEEDING_ML;
  else if (p.screening?.pregnant) base = PREGNANT_ML;
  const workoutMl = Math.min(MAX_WORKOUT_ML, r50((Math.max(0, workoutMin) / 60) * ML_PER_WORKOUT_HOUR));
  const heatMl = p.hotEnvironment ? HEAT_ML : 0;
  return { targetMl: supervised ? null : base + workoutMl + heatMl, baseMl: base, workoutMl, heatMl, supervised };
}

/** ml of liquid in a logged drink: grams ≈ ml; else by unit; else a 250 ml glass per item. */
export function drinkMl(items: Pick<MealItem, 'grams' | 'quantity' | 'unit'>[]): number {
  let ml = 0;
  for (const it of items) {
    const q = Number(it.quantity) || 1;
    const u = String(it.unit || '').toLowerCase();
    if (it.grams && it.grams > 0) ml += it.grams;
    else if (u === 'ml') ml += q;
    else if (u === 'l' || u === 'liter' || u === 'litre') ml += q * 1000;
    else if (u.includes('cup') || u.includes('كوب')) ml += q * 240;
    else if (u.includes('can') || u.includes('علبة')) ml += q * 330;
    else ml += q * 250;
  }
  return Math.min(2000, Math.round(ml));
}

/** expected share of the target by this local minute (0 before 08:00 … 1 after 22:00) */
export function expectedShare(minuteOfDay: number): number {
  return Math.max(0, Math.min(1, (minuteOfDay - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)));
}

const WATER_CHECKS = [11 * 60, 14 * 60, 17 * 60, 20 * 60];

/**
 * Water nudge (pure): at 11:00 / 14:00 / 17:00 / 20:00 (30-min window) when ≥500 ml behind the expected pace.
 * Fasting: never. Ramadan/fasting day after iftar: one nudge 2 h after iftar if under half the target.
 */
export function dueWaterReminder(i: {
  nowMin: number; intakeMl: number; expectedMl: number | null; targetMl: number | null;
  fasting: boolean; fastDay: boolean; iftarMin: number | null; lang: string;
}): { key: string; title: string; body: string } | null {
  if (i.targetMl == null || i.fasting || i.nowMin >= 23 * 60 || i.nowMin < 7 * 60) return null;
  const ar = i.lang === 'ar';
  const left = Math.max(0, i.targetMl - i.intakeMl);
  if (i.fastDay) {
    const t = (i.iftarMin ?? 18 * 60) + 120;
    if (i.nowMin >= t && i.nowMin < t + 30 && i.intakeMl < i.targetMl / 2)
      return ar ? { key: 'water:iftar', title: 'اشرب ماء 💧', body: `باقي ${left} مل قبل السحور — وزّعها على دفعات.` }
        : { key: 'water:iftar', title: 'Time for water 💧', body: `${left} ml to go before suhoor — spread it out.` };
    return null;
  }
  const cp = WATER_CHECKS.find((c) => i.nowMin >= c && i.nowMin < c + 30);
  if (cp == null || i.expectedMl == null || i.expectedMl - i.intakeMl < 500) return null;
  const behind = Math.round((i.expectedMl - i.intakeMl) / 50) * 50;
  return ar ? { key: `water:${cp / 60}`, title: 'اشرب ماء 💧', body: `أنت متأخر ${behind} مل عن هدفك لهالوقت — كوب الحين يقربك.` }
    : { key: `water:${cp / 60}`, title: 'Drink some water 💧', body: `You're ${behind} ml behind for this time of day — a glass now helps.` };
}

/** largest amount logged inside any 60-minute window */
export function maxHourMl(entries: { at: string; ml: number }[]): number {
  const xs = entries.map((e) => ({ t: Date.parse(e.at), ml: e.ml })).sort((a, b) => a.t - b.t);
  let best = 0, sum = 0, j = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i].ml;
    while (xs[i].t - xs[j].t >= 3600_000) sum -= xs[j++].ml;
    best = Math.max(best, sum);
  }
  return best;
}
