/**
 * Group challenge scoring. Everyone is measured against their OWN targets, so a beginner can beat an athlete,
 * and nobody wins by eating less: calories score on being inside the target band, not on a low number.
 * Weight never enters the score.
 */
export type Tab = 'total' | 'steps' | 'protein' | 'calories' | 'water' | 'strain';
export type Period = 'day' | 'week' | 'month';
export const TABS: Tab[] = ['total', 'steps', 'protein', 'calories', 'water', 'strain'];
export const PERIODS: Period[] = ['day', 'week', 'month'];

export interface DayStat {
  date: string;
  meals: number;
  intakeKcal: number;
  targetKcal: number;
  proteinG: number;
  proteinTarget: number | null;
  waterMl: number | null;
  waterTarget: number | null;
  steps: number | null;
  stepGoal: number | null;
  strain: number | null;
  strainAvg: number | null; // the user's own recent average strain
  goal: 'lose' | 'maintain' | 'gain';
}

/** Daily points: calories 5, protein 3, steps 3, water 2, logged food 1 → 14/day. */
export const POINTS = { calories: 5, protein: 3, steps: 3, water: 2, logged: 1 } as const;
export const POINTS_PER_DAY = 14;
const PROTEIN_HIT = 0.9;

export function calorieBand(d: Pick<DayStat, 'targetKcal' | 'goal'>): [number, number] {
  // Lose/maintain: up to 5% over is fine; under 70% doesn't count (no reward for starving). Gain: 95–115%.
  return d.goal === 'gain' ? [d.targetKcal * 0.95, d.targetKcal * 1.15] : [d.targetKcal * 0.7, d.targetKcal * 1.05];
}

export function calorieScore(d: DayStat): number {
  if (!d.meals || !d.targetKcal) return 0;
  const [lo, hi] = calorieBand(d);
  if (d.intakeKcal >= lo && d.intakeKcal <= hi) return 100;
  const off = d.intakeKcal < lo ? lo - d.intakeKcal : d.intakeKcal - hi;
  return Math.max(0, Math.min(99, Math.round(100 - (off / d.targetKcal) * 200)));
}

export const hits = {
  calories: (d: DayStat) => calorieScore(d) === 100,
  protein: (d: DayStat) => !!d.proteinTarget && d.meals > 0 && d.proteinG >= d.proteinTarget * PROTEIN_HIT,
  steps: (d: DayStat) => d.steps != null && !!d.stepGoal && d.steps >= d.stepGoal,
  water: (d: DayStat) => d.waterMl != null && !!d.waterTarget && d.waterMl >= d.waterTarget,
  strain: (d: DayStat) => d.strain != null && !!d.strainAvg && d.strain >= d.strainAvg,
};

export function dayPoints(d: DayStat): number {
  return (hits.calories(d) ? POINTS.calories : 0) + (hits.protein(d) ? POINTS.protein : 0) + (hits.steps(d) ? POINTS.steps : 0) +
    (hits.water(d) ? POINTS.water : 0) + (d.meals > 0 ? POINTS.logged : 0);
}

/** % for one day on one tab (null = no data for that tab, e.g. no WHOOP). */
export function dayPct(tab: Tab, d: DayStat): number | null {
  const cap = (v: number, c = 150) => Math.max(0, Math.min(c, Math.round(v)));
  switch (tab) {
    case 'total': return cap((dayPoints(d) / POINTS_PER_DAY) * 100, 100);
    case 'steps': return d.steps != null && d.stepGoal ? cap((d.steps / d.stepGoal) * 100) : null;
    case 'protein': return d.proteinTarget ? cap((d.proteinG / d.proteinTarget) * 100) : null;
    case 'calories': return calorieScore(d);
    case 'water': return d.waterMl != null && d.waterTarget ? cap((d.waterMl / d.waterTarget) * 100) : null;
    case 'strain': return d.strain != null && d.strainAvg ? cap((d.strain / d.strainAvg) * 100, 200) : null;
  }
}

export interface MemberScore {
  pct: number;
  /** what the sub-line shows (client formats/localises it) */
  detail: { kind: 'value' | 'days' | 'points' | 'status'; ok?: boolean; value?: number; target?: number | null; hit?: number; of?: number; points?: number; max?: number };
}

/**
 * Score a member over the period's days (oldest → newest; the last one is "today").
 * Day: today's %. Week/month: average daily % (each day capped at 100 so consistency wins, steps/strain keep their bonus).
 */
export function scoreMember(tab: Tab, period: Period, days: DayStat[]): MemberScore | null {
  if (!days.length) return null;
  const today = days[days.length - 1];
  if (tab === 'total') {
    const pts = days.reduce((a, d) => a + dayPoints(d), 0);
    const max = POINTS_PER_DAY * days.length;
    return { pct: Math.round((pts / max) * 100), detail: { kind: 'points', points: pts, max } };
  }
  if (period === 'day') {
    const p = dayPct(tab, today);
    if (p == null) return null;
    const value = tab === 'steps' ? today.steps : tab === 'protein' ? today.proteinG : tab === 'calories' ? today.intakeKcal : tab === 'water' ? today.waterMl : today.strain;
    const target = tab === 'steps' ? today.stepGoal : tab === 'protein' ? today.proteinTarget : tab === 'calories' ? today.targetKcal : tab === 'water' ? today.waterTarget : today.strainAvg;
    return { pct: p, detail: { kind: 'value', value: value ?? 0, target: target ?? null } };
  }
  const per = days.map((d) => dayPct(tab, d)).filter((x): x is number => x != null);
  if (!per.length) return null;
  const keepBonus = tab === 'steps' || tab === 'strain';
  const avg = per.reduce((a, x) => a + (keepBonus ? x : Math.min(100, x)), 0) / per.length;
  const hit = days.filter((d) => (hits as Record<string, (d: DayStat) => boolean>)[tab](d)).length;
  return { pct: Math.round(avg), detail: { kind: 'days', hit, of: days.length } };
}

/** Consecutive days with a logged meal, ending today (or yesterday when today has nothing yet). */
export function loggingStreak(days: DayStat[]): number {
  let i = days.length - 1;
  if (i >= 0 && days[i].meals === 0) i--;
  let n = 0;
  for (; i >= 0 && days[i].meals > 0; i--) n++;
  return n;
}
