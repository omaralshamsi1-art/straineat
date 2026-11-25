import { Injectable } from '@nestjs/common';
import { localDate } from '../common/dates';
import { ProfileService } from '../profile/profile.service';
import { PlanService, addDays } from '../plan/plan.service';
import { WaterService } from '../water/water.service';
import { StepsService } from '../steps/steps.service';

/** Monday of the week containing `date` (UAE week runs Monday–Sunday). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  return addDays(date, -dow);
}

export const PROTEIN_HIT = 0.9;

/**
 * This week so far: calorie budget (sum of the daily targets, the rest of the week at the plan target),
 * and how many days hit protein / water / steps.
 */
@Injectable()
export class WeekService {
  constructor(
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
    private readonly water: WaterService,
    private readonly steps: StepsService,
  ) {}

  async summary(userId: string) {
    const p = await this.profiles.get(userId);
    const today = localDate(new Date(), p.timezone);
    const start = weekStart(today);
    const n = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
    const [hist, plan] = await Promise.all([this.plans.history(userId, n), this.plans.plan(userId)]);
    const proteinTarget = plan.proteinG || null;
    type Day = { date: string; intakeKcal: number; targetKcal: number; meals: number; proteinG: number; proteinHit: boolean; waterMl: number | null; waterHit: boolean; steps: number | null; stepsHit: boolean };
    const days: Day[] = [];
    for (const d of hist.days) {
      const [w, s] = await Promise.all([this.water.day(userId, d.date).catch(() => null), this.steps.day(userId, d.date).catch(() => null)]);
      days.push({
        date: d.date,
        intakeKcal: d.intakeKcal,
        targetKcal: d.targetKcal,
        meals: d.meals,
        proteinG: d.proteinG,
        proteinHit: !!proteinTarget && d.meals > 0 && d.proteinG >= proteinTarget * PROTEIN_HIT,
        waterMl: w?.intakeMl ?? null,
        waterHit: !!w?.targetMl && w.intakeMl >= w.targetMl,
        steps: s?.steps ?? null,
        stepsHit: s?.steps != null && s.steps >= s.goal,
      });
    }
    const eaten = days.reduce((a, d) => a + d.intakeKcal, 0);
    const soFar = days.reduce((a, d) => a + d.targetKcal, 0);
    const weekTarget = soFar + (7 - days.length) * plan.targetKcal;
    const count = (k: 'proteinHit' | 'waterHit' | 'stepsHit') => days.filter((d) => d[k]).length;
    return {
      weekStart: start,
      today,
      dayIndex: days.length, // 1 = Monday … 7 = Sunday
      budget: {
        eatenKcal: eaten,
        weekTargetKcal: weekTarget,
        remainingKcal: weekTarget - eaten,
        /** how far over/under the targets of the days so far (logged days only) */
        balanceSoFarKcal: days.filter((d) => d.meals > 0).reduce((a, d) => a + d.intakeKcal - d.targetKcal, 0),
        daysLeft: 7 - days.length + 1,
      },
      proteinDays: { hit: count('proteinHit'), of: 7, targetG: proteinTarget },
      waterDays: { hit: count('waterHit'), of: 7 },
      stepsDays: { hit: count('stepsHit'), of: 7 },
      days,
    };
  }
}
