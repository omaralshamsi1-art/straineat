import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { weekStart } from '../src/week/week.service';
import { validateProfilePatch } from '../src/profile/profile.service';

describe('week + today layout', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-25')).toBe('2026-11-23'); // Wed → Mon
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sun
  });
  it('validates the Today layout', () => {
    expect(validateProfilePatch({ todayLayout: { hero: 'week_budget', tiles: ['steps', 'water', 'steps'] } })).toEqual({ todayLayout: { hero: 'week_budget', tiles: ['steps', 'water'] } });
    expect(() => validateProfilePatch({ todayLayout: { hero: 'nope', tiles: [] } })).toThrow();
    expect(() => validateProfilePatch({ todayLayout: { hero: 'rings', tiles: ['bogus'] } })).toThrow();
  });
});

describe('week summary', () => {
  it('budget, protein / water / steps days', async () => {
    const { MemoryRepository } = await import('../src/storage/memory.repository');
    const { ProfileService } = await import('../src/profile/profile.service');
    const { PlanService } = await import('../src/plan/plan.service');
    const { WaterService } = await import('../src/water/water.service');
    const { StepsService } = await import('../src/steps/steps.service');
    const { WeekService } = await import('../src/week/week.service');
    const { localDate } = await import('../src/common/dates');
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', timezone: 'Asia/Dubai' } as any);
    const plans = new PlanService(repo, profiles);
    const water = new WaterService(repo, profiles);
    const steps = new StepsService(repo, profiles);
    const week = new WeekService(profiles, plans, water, steps);
    const today = localDate(new Date(), 'Asia/Dubai');
    const plan = await plans.plan('u');
    await repo.saveMeal({ id: 'm1', userId: 'u', date: today, status: 'confirmed', eatenAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      final: { kind: 'meal', meal_name: 'x', meal_name_ar: 'x', items: [], totals: { calories: 900, protein_g: plan.proteinG, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 } } } as any);
    await steps.ingest('u', [{ date: today, steps: 20000 }]);
    const w = await week.summary('u');
    expect(w.days.at(-1)).toMatchObject({ date: today, intakeKcal: 900, proteinHit: true, stepsHit: true, waterHit: false });
    expect(w.proteinDays.hit).toBe(1);
    expect(w.stepsDays.hit).toBe(1);
    expect(w.budget.eatenKcal).toBe(900);
    expect(w.budget.weekTargetKcal).toBeGreaterThan(plan.targetKcal * 6);
    expect(w.budget.remainingKcal).toBe(w.budget.weekTargetKcal - 900);
  });
});

describe('steps from several sources', () => {
  it('keeps each source and shows the highest; a later lower reading from one source replaces only that source', async () => {
    const { mergeSteps } = await import('../src/steps/steps.service');
    let d = mergeSteps(null, 'shortcut', 53, '2026-11-25T03:00:00Z');
    d = mergeSteps(d, 'whoop', 6400, '2026-11-25T09:00:00Z');
    d = mergeSteps(d, 'apple_health', 5900, '2026-11-25T09:05:00Z');
    expect(d).toMatchObject({ steps: 6400, source: 'whoop' });
    d = mergeSteps(d, 'apple_health', 7100, '2026-11-25T10:00:00Z');
    expect(d).toMatchObject({ steps: 7100, source: 'apple_health' });
    expect(Object.keys(d.sources!)).toEqual(['shortcut', 'whoop', 'apple_health']);
    // legacy single-source record upgrades
    expect(mergeSteps({ steps: 53, source: 'apple_health', updatedAt: 'x' }, 'whoop', 900, 'y')).toMatchObject({ steps: 900, source: 'whoop' });
  });
});
