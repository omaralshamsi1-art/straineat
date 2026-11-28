import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '../common/dates';
import { ProfileService } from '../profile/profile.service';
import { PlanService, addDays } from '../plan/plan.service';
import { WaterService } from '../water/water.service';
import { StepsService } from '../steps/steps.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { PROTEIN_HIT, weekStart } from '../week/week.service';

const DAY = 86400000;
const dayNum = (d: string) => Date.parse(`${d}T12:00:00Z`) / DAY;
const r1 = (x: number) => Math.round(x * 10) / 10;
export const TREND_MIN_DAYS = 14;

/** Least-squares slope (kg per day) of weigh-ins. */
export function slopePerDay(points: { date: string; kg: number }[]): number | null {
  if (points.length < 3) return null;
  const xs = points.map((p) => dayNum(p.date)), ys = points.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

/** Calories "on target": lose/maintain 70–105 % of the day's target, gain 95–115 %. */
export function caloriesHit(goal: string, intake: number, target: number): boolean {
  if (!target) return false;
  const r = intake / target;
  return goal === 'gain' ? r >= 0.95 && r <= 1.15 : r >= 0.7 && r <= 1.05;
}

export function bmiZone(b: number): 'under' | 'normal' | 'over' | 'obese' {
  return b < 18.5 ? 'under' : b < 25 ? 'normal' : b < 30 ? 'over' : 'obese';
}

/** Progress page header: journey to the goal weight, BMI, this week's habits, 7-day nutrition monitor. */
@Injectable()
export class ProgressService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
    private readonly water: WaterService,
    private readonly steps: StepsService,
  ) {}

  async summary(userId: string) {
    const p = await this.profiles.get(userId);
    const today = localDate(new Date(), p.timezone);
    const plan: any = await this.plans.plan(userId);
    const weights = (await this.repo.listWeights(userId, addDays(today, -180), today)).sort((a, b) => a.date.localeCompare(b.date));
    const current = weights.length ? weights[weights.length - 1].kg : plan.currentWeightKg ?? p.weightKg ?? null;

    return {
      today,
      journey: this.journey(p, plan, weights, current, today),
      // BMI from the smoothed trend weight — the same number My plan uses
      bmi: this.bmi(p, weights, plan.currentWeightKg ?? current, today, plan.targetWeightKg),
      week: await this.week(userId, p, plan, today),
      monitor: await this.monitor(userId, today),
    };
  }

  private journey(p: any, plan: any, weights: { date: string; kg: number }[], current: number | null, today: string) {
    // the journey starts at the earliest known weight: the profile start, or an older weigh-in
    let start = plan.startWeightKg ?? p.startWeightKg ?? null;
    let startDateKnown: string | null = p.startDate ?? null;
    if (weights.length && (!startDateKnown || weights[0].date < startDateKnown)) { start = weights[0].kg; startDateKnown = weights[0].date; }
    const target = plan.targetWeightKg ?? p.targetWeightKg ?? null;
    if (!start || !target || !current || Math.abs(start - target) < 0.5) return { status: 'no_target' as const, currentKg: current };
    const dir = target < start ? -1 : 1;
    const frac = Math.max(0, Math.min(1, (current - start) / (target - start)));
    const startDate: string = startDateKnown ?? today;
    const weekly: number = plan.weeklyChangeKg || 0; // negative = loss
    const weeksIn = Math.max(0, (dayNum(today) - dayNum(startDate)) / 7);
    const expectedKg = weekly ? start + weekly * weeksIn : null;
    const planFrac = expectedKg == null ? null : Math.max(0, Math.min(1, (expectedKg - start) / (target - start)));
    const span = 3, milestones = [1, 2, 3].map((i) => r1(start + ((target - start) * i) / (span + 1)));
    const base = { currentKg: r1(current), startKg: r1(start), targetKg: r1(target), frac: r1(frac * 100) / 100, planFrac: planFrac == null ? null : Math.round(planFrac * 100) / 100, milestones, startDate };
    if (frac >= 1) return { status: 'reached' as const, ...base };
    // trend from the last 4 weeks of weigh-ins
    const recent = weights.filter((w) => w.date >= addDays(today, -28));
    const spanDays = recent.length ? dayNum(recent[recent.length - 1].date) - dayNum(recent[0].date) : 0;
    const daysOfData = weights.length ? Math.round(dayNum(today) - dayNum(weights[0].date)) + 1 : 0;
    const slope = spanDays >= TREND_MIN_DAYS - 1 ? slopePerDay(recent) : null;
    const planEta = weekly && Math.sign(weekly) === dir ? addDays(today, Math.round((target - current) / (weekly / 7))) : null;
    if (slope == null) return { status: 'collecting' as const, ...base, daysOfData, needDays: TREND_MIN_DAYS, planEta };
    const weeklyActual = Math.round(slope * 7 * 100) / 100;
    if (Math.sign(slope) !== dir || Math.abs(slope * 7) < 0.05) return { status: 'stalled' as const, ...base, weeklyActualKg: weeklyActual, planEta };
    const days = Math.round((target - current) / slope);
    const eta = addDays(today, Math.min(days, 3650));
    const aheadDays = planEta ? Math.round(dayNum(planEta) - dayNum(eta)) : null;
    const pace = weekly ? Math.round(((slope * 7) / weekly) * 10) / 10 : null;
    const tooFast = dir < 0 && -slope * 7 > Math.max(1, current * 0.01);
    return { status: 'on_way' as const, ...base, eta, planEta, aheadDays, pace, weeklyActualKg: weeklyActual, tooFast };
  }

  private bmi(p: any, weights: { date: string; kg: number }[], current: number | null, today: string, target: number | null) {
    if (!p.heightCm || !current) return null;
    const h = p.heightCm / 100, b = (kg: number) => Math.round((kg / (h * h)) * 10) / 10;
    const value = b(current);
    const monthAgo = [...weights].reverse().find((w) => w.date <= addDays(today, -28));
    const toNormal = value >= 25 ? r1(value - 24.9) : value < 18.5 ? r1(18.5 - value) : 0;
    return { value, zone: bmiZone(value), target: target ? b(target) : null, deltaMonth: monthAgo ? r1(value - b(monthAgo.kg)) : null, toNormal };
  }

  private async week(userId: string, p: any, plan: any, today: string) {
    const start = weekStart(today), prevStart = addDays(start, -7);
    const n = Math.round(dayNum(today) - dayNum(prevStart)) + 1;
    const hist = await this.plans.history(userId, n);
    const goal = plan.effectiveGoal ?? p.goal;
    const proteinT = plan.proteinG || 0;
    type Row = { date: string; calories: boolean; protein: boolean; logged: boolean; water: boolean; steps: boolean | null; active: boolean };
    const rows: Row[] = [];
    for (const d of hist.days) {
      const [w, s] = await Promise.all([this.water.day(userId, d.date).catch(() => null), this.steps.day(userId, d.date).catch(() => null)]);
      rows.push({
        date: d.date,
        logged: d.meals > 0,
        calories: d.meals > 0 && caloriesHit(goal, d.intakeKcal, d.targetKcal),
        protein: d.meals > 0 && !!proteinT && d.proteinG >= proteinT * PROTEIN_HIT,
        water: !!w?.targetMl && w.intakeMl >= w.targetMl,
        steps: s?.steps == null ? null : s.steps >= s.goal,
        active: d.meals > 0 || (w?.intakeMl ?? 0) > 0,
      });
    }
    // days before the user started tracking (signup, or no data at all yet) aren't counted as misses
    const firstActive = rows.find((r) => r.active)?.date ?? today;
    rows.splice(0, rows.length, ...rows.filter((r) => r.date >= firstActive));
    const hasSteps = rows.some((r) => r.steps != null);
    const habits = ['calories', 'protein', 'logged', 'water', ...(hasSteps ? ['steps'] : [])] as (keyof Row)[];
    const score = (list: Row[]) => {
      if (!list.length) return null;
      let hit = 0, of = 0;
      for (const r of list) for (const h of habits) { of++; if (r[h] === true) hit++; }
      return of ? Math.round((hit / of) * 100) : null;
    };
    const thisWeek = rows.filter((r) => r.date >= start), lastWeek = rows.filter((r) => r.date < start && r.date >= prevStart);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const grid = habits.map((h) => ({
      habit: h,
      days: days.map((d) => { const r = thisWeek.find((x) => x.date === d); return r ? (r[h] === null ? null : !!r[h]) : null; }),
      hit: thisWeek.filter((r) => r[h] === true).length,
    }));
    const weakest = [...grid].filter((g) => g.habit !== 'logged').sort((a, b) => a.hit - b.hit)[0];
    const now = score(thisWeek), prev = score(lastWeek);
    return { weekStart: start, score: now, lastWeekScore: prev, delta: now != null && prev != null ? now - prev : null, daysSoFar: thisWeek.length, grid, weakest: weakest ? { habit: weakest.habit, hit: weakest.hit, of: thisWeek.length } : null };
  }

  private async monitor(userId: string, today: string) {
    const from = addDays(today, -6);
    const meals = (await this.repo.listMealsRange(userId, from, today)).filter((m) => m.status === 'confirmed');
    const byDay = new Map<string, { sugar: number; sodium: number; fiber: number }>();
    for (const m of meals) {
      const t = m.final.totals as any, d = byDay.get(m.date) ?? { sugar: 0, sodium: 0, fiber: 0 };
      d.sugar += t.sugar_g || 0; d.sodium += t.sodium_mg || 0; d.fiber += t.fiber_g || 0;
      byDay.set(m.date, d);
    }
    const logged = [...byDay.values()], n = logged.length;
    const avg = (k: 'sugar' | 'sodium' | 'fiber') => (n ? logged.reduce((a, d) => a + d[k], 0) / n : null);
    const waters: { intake: number; target: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const w = await this.water.day(userId, addDays(from, i)).catch(() => null);
      if (w && w.intakeMl > 0) waters.push({ intake: w.intakeMl, target: w.targetMl || 0 });
    }
    const wAvg = waters.length ? waters.reduce((a, w) => a + w.intake, 0) / waters.length : null;
    const wTarget = waters.length ? waters.reduce((a, w) => a + w.target, 0) / waters.length : null;
    const sugar = avg('sugar'), sodium = avg('sodium'), fiber = avg('fiber');
    return {
      loggedDays: n,
      // WHO: free sugars under ~50 g (10 % of 2,000 kcal), sodium under 2 g; fibre 25 g+
      sugar: sugar == null ? null : { g: Math.round(sugar), level: sugar <= 50 ? 'ok' : 'high', fill: Math.min(1, sugar / 75) },
      sodium: sodium == null ? null : { mg: Math.round(sodium), level: sodium <= 2000 ? 'ok' : 'high', fill: Math.min(1, sodium / 3000) },
      fiber: fiber == null ? null : { g: Math.round(fiber), level: fiber >= 25 ? 'good' : fiber >= 15 ? 'ok' : 'low', fill: Math.min(1, fiber / 30) },
      water: wAvg == null ? null : { ml: Math.round(wAvg), targetMl: wTarget ? Math.round(wTarget) : null, level: wTarget && wAvg >= wTarget * 0.9 ? 'good' : 'low', fill: wTarget ? Math.min(1, wAvg / wTarget) : 0.5 },
    };
  }
}
