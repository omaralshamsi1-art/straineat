import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { adaptiveMaintenance, calibrateActivity, calorieFloor, computePlan, PlanInput, weightTrend } from '../src/plan/plan-math';
import { addDays } from '../src/plan/plan.service';
import { localDate } from '../src/common/dates';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService, validateProfilePatch } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  goal: 'lose', pace: 'moderate', sex: 'female', age: 26, heightCm: 165, weightKg: 80, targetWeightKg: 68,
  maintenanceKcal: 2200, maintenanceSource: 'device', bmr: 1500, screening: {}, today: new Date('2026-11-20T00:00:00Z'), ...o,
});

describe('goal engine', () => {
  it('moderate loss ≈0.5% body weight / week with ETA', () => {
    const p = computePlan(base());
    // 80 kg × 0.5% = 0.4 kg/wk → 440 kcal/day deficit
    expect(p.targetKcal).toBe(1760);
    expect(p.weeklyChangeKg).toBeCloseTo(-0.4, 1);
    expect(p.weeksToGoal).toBe(30);
    expect(p.etaDate).toBe('2027-06-18'); // 30 weeks = 210 days
    expect(p.proteinG).toBe(145); // 1.8 g/kg × 80
    expect(p.fatG * 9 + p.proteinG * 4 + p.carbsG * 4).toBeLessThanOrEqual(p.targetKcal + 20);
  });

  it('caps loss at 1 kg/week and 1000 kcal/day, and never goes under the floor', () => {
    const p = computePlan(base({ weightKg: 160, heightCm: 175, targetWeightKg: 90, pace: 'fast', maintenanceKcal: 3400, bmr: 2300 }));
    expect(p.dailyDeltaKcal).toBeGreaterThanOrEqual(-1000);
    const small = computePlan(base({ weightKg: 55, heightCm: 160, targetWeightKg: 52, pace: 'fast', maintenanceKcal: 1450, bmr: 1280 }));
    expect(small.targetKcal).toBe(calorieFloor('female', 1280)); // 1280 (BMR > 1200)
    expect(small.limitedByFloor).toBe(true);
    expect(small.notices.some((n) => n.code === 'floor')).toBe(true);
  });

  it('protein is based on a BMI-25 reference weight when BMI > 30', () => {
    const p = computePlan(base({ weightKg: 120, heightCm: 170, targetWeightKg: 85 }));
    expect(p.proteinG).toBe(130); // 25 × 1.7² = 72.25 kg × 1.8 = 130
  });

  it('lean gain uses a small surplus (≤500)', () => {
    const p = computePlan(base({ goal: 'gain', weightKg: 60, targetWeightKg: 66, maintenanceKcal: 2300 }));
    expect(p.dailyDeltaKcal).toBeGreaterThan(0);
    expect(p.dailyDeltaKcal).toBeLessThanOrEqual(500);
    expect(p.weeklyChangeKg).toBeCloseTo(0.15, 1);
  });

  it('safety: under 18, pregnancy, ED history and underweight never get a deficit', () => {
    for (const o of [{ age: 16 }, { screening: { pregnant: true } }, { screening: { edHistory: true } }, { weightKg: 48, heightCm: 165 }] as Partial<PlanInput>[]) {
      const p = computePlan(base(o));
      expect(p.effectiveGoal).toBe('maintain');
      expect(p.dailyDeltaKcal).toBe(0);
      expect(p.notices.some((n) => n.level === 'stop')).toBe(true);
    }
  });

  it('switches to maintain when the target is reached', () => {
    const p = computePlan(base({ weightKg: 67.5, targetWeightKg: 68 }));
    expect(p.effectiveGoal).toBe('maintain');
    expect(p.notices[0].code).toBe('target_reached');
  });

  it('weight trend smooths noise and adaptive maintenance learns from intake vs trend', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      kg: 80 - i * 0.07 + (i % 2 ? 0.6 : -0.6), // −0.5 kg/week + ±0.6 kg noise
    }));
    const t = weightTrend(pts);
    expect(Math.abs(t[20].trend - t[19].trend)).toBeLessThan(0.2);
    const days = pts.map((p) => ({ date: p.date, kcal: 1700 }));
    const a = adaptiveMaintenance({ baseline: 2000, loggedDays: days, trend: t });
    expect(a.adaptive).toBe(true);
    expect(a.observed).toBeGreaterThan(1700); // losing while eating 1700 → burns more than 1700
    expect(adaptiveMaintenance({ baseline: 2000, loggedDays: days.slice(0, 5), trend: t }).adaptive).toBe(false);
  });

  it('validates profile input', () => {
    expect(() => validateProfilePatch({ pace: 'turbo' as any })).toThrow();
    expect(() => validateProfilePatch({ targetWeightKg: 5 })).toThrow();
    expect(validateProfilePatch({ heightCm: '170' as any, screening: { pregnant: 1 as any, hack: true } as any })).toEqual({
      heightCm: 170, screening: { pregnant: true },
    });
  });
});

describe('PlanService', () => {
  it('weights: one per day (manual wins), sets start weight, feeds the plan; preview does not save', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    await profiles.update('u', { sex: 'female', birthYear: 1998, heightCm: 165, goal: 'lose', targetWeightKg: 65, pace: 'moderate' });
    await repo.upsertWeight({ userId: 'u', date: '2026-11-18', kg: 79.4, source: 'whoop', updatedAt: '' });
    await plans.addWeight('u', { kg: 80, date: '2026-11-18' });
    const w = await plans.weights('u', 30);
    expect(w.entries).toHaveLength(1);
    expect(w.entries[0].source).toBe('manual');
    expect((await profiles.get('u')).startWeightKg).toBe(80);
    const p = await plans.plan('u');
    expect(p.currentWeightKg).toBe(80);
    expect(p.targetKcal).toBeLessThan(p.maintenanceKcal);
    const prev = await plans.plan('u', { goal: 'gain', targetWeightKg: 85 });
    expect(prev.targetKcal).toBeGreaterThan(prev.maintenanceKcal);
    expect((await profiles.get('u')).goal).toBe('lose');
    await expect(plans.addWeight('u', { kg: 5 })).rejects.toThrow();
  });
});

describe('burn calibration (7–14 days)', () => {

  it('maps measured burn ÷ BMR to the nearest activity level', () => {
    expect(calibrateActivity('moderate', 1950, 1750)?.to).toBe('sedentary'); // 1.11
    expect(calibrateActivity('moderate', 2400, 1750)?.to).toBe('light'); // 1.37
    expect(calibrateActivity('moderate', 2700, 1750)).toBeNull(); // 1.54 fits
    expect(calibrateActivity('light', 3000, 1750)?.to).toBe('active'); // 1.71
  });

  async function seed(days: number, kcal: number) {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    // male, 47, 176 cm, 88 kg → BMR 1750; declared "moderate" → formula 2713
    await profiles.update('u', { sex: 'male', birthYear: new Date().getFullYear() - 47, heightCm: 176, activityLevel: 'moderate', goal: 'lose', pace: 'fast', targetWeightKg: 81, onboarded: true });
    await plans.addWeight('u', { kg: 88 });
    const today = localDate(new Date(), 'Asia/Dubai');
    for (let i = 1; i <= days; i++) {
      await repo.upsertEnergy({ userId: 'u', date: addDays(today, -i), source: 'whoop', activeKcal: null, basalKcal: null, totalKcal: kcal, updatedAt: '' });
    }
    // today's partial cycle must be ignored
    await repo.upsertEnergy({ userId: 'u', date: today, source: 'whoop', activeKcal: null, basalKcal: null, totalKcal: 400, updatedAt: '' });
    return { repo, profiles, plans };
  }

  it('keeps the formula and reports progress before 7 days', async () => {
    const { plans, profiles } = await seed(6, 1950);
    const p = await plans.plan('u');
    expect(p.maintenanceSource).toBe('formula');
    expect(p.maintenanceKcal).toBe(2710);
    expect(p.burnData).toMatchObject({ days: 6, needed: 7 });
    expect(p.notices.some((n) => n.code === 'collecting_burn')).toBe(true);
    expect((await profiles.get('u')).activityLevel).toBe('moderate');
  });

  it('after 7 days uses measured burn and auto-corrects the activity level once, with a notice', async () => {
    const { plans, profiles } = await seed(9, 1950);
    const p = await plans.plan('u');
    expect(p.maintenanceSource).toBe('device');
    expect(p.maintenanceKcal).toBe(1950);
    expect(p.activityLevel).toBe('sedentary');
    const prof = await profiles.get('u');
    expect(prof.activityLevel).toBe('sedentary');
    expect(prof.activityCalibration).toMatchObject({ from: 'moderate', to: 'sedentary', days: 9, avgBurnKcal: 1950 });
    expect(p.notices[0].code).toBe('activity_calibrated');
    expect(p.targetKcal).toBe(1750); // floor = BMR; deficit limited
    expect(p.limitedByFloor).toBe(true);
    // second read the same day: no duplicate change
    const again = await plans.plan('u');
    expect(again.activityCalibration?.from).toBe('moderate');
  });

  it('averages only the last 14 complete days and ignores barely-worn days', async () => {
    const { repo, plans } = await seed(20, 2000);
    const today = localDate(new Date(), 'Asia/Dubai');
    await repo.upsertEnergy({ userId: 'u', date: addDays(today, -2), source: 'whoop', activeKcal: null, basalKcal: null, totalKcal: 600, updatedAt: '' });
    const p = await plans.plan('u');
    expect(p.burnData.days).toBe(13); // 14-day window minus the 600-kcal day
    expect(p.burnData.avgKcal).toBe(2000);
  });

  it('onboarding previews never change the saved activity level', async () => {
    const { plans, profiles } = await seed(9, 1950);
    await plans.plan('u', { goal: 'gain' });
    expect((await profiles.get('u')).activityLevel).toBe('moderate');
  });
});

describe('intense pace and target date', () => {
  // 100 kg, 170 cm → BMI 34.6
  const big = (o: Partial<PlanInput> = {}) => base({ weightKg: 100, heightCm: 170, targetWeightKg: 85, maintenanceKcal: 2900, bmr: 1750, ...o });

  it('intense: ~1% body weight a week, under the gallstone line, more protein, advice attached', () => {
    const p = computePlan(big({ pace: 'intense' }));
    expect(p.intense).toBe(true);
    expect(-p.weeklyChangeKg).toBeGreaterThan(0.75);
    expect(-p.weeklyChangeKg).toBeLessThan(1.36); // 3 lb/week (NIDDK)
    expect(p.dailyDeltaKcal).toBeGreaterThanOrEqual(-1300);
    expect(p.targetKcal).toBeGreaterThanOrEqual(p.floorKcal);
    expect(p.advice.length).toBeGreaterThanOrEqual(5);
    expect(p.notices.map((n) => n.code)).toContain('intense');
    expect(p.proteinG).toBeGreaterThan(computePlan(big({ pace: 'fast' })).proteinG);
  });

  it('intense is not offered under BMI 25, with a medical condition, or after 65', () => {
    for (const o of [{ weightKg: 70, heightCm: 175, targetWeightKg: 65 }, { screening: { medicalSupervision: true } }, { age: 70 }] as Partial<PlanInput>[]) {
      const p = computePlan(big({ pace: 'intense', ...o }));
      expect(p.intense).toBe(false);
      expect(p.notices.map((n) => n.code)).toContain('intense_unavailable');
    }
  });

  it('target date sets the pace; an impossible date falls back to the safe maximum with a realistic ETA', () => {
    const ok = computePlan(big({ targetDate: '2027-05-21' })); // 26 weeks for 15 kg → ~0.58 kg/wk
    expect(ok.deadline).toMatchObject({ feasible: true });
    expect(ok.deadline!.requiredKgWeek).toBeCloseTo(0.58, 1);
    expect(-ok.weeklyChangeKg).toBeCloseTo(0.58, 1);
    expect(ok.notices.map((n) => n.code)).toContain('deadline_ok');

    const rush = computePlan(big({ targetDate: '2026-12-25' })); // 5 weeks for 15 kg
    expect(rush.deadline).toMatchObject({ feasible: false });
    expect(-rush.weeklyChangeKg).toBeLessThanOrEqual(rush.maxSafeKgWeek! + 0.01);
    expect(rush.notices.map((n) => n.code)).toContain('deadline_unrealistic');
    expect(rush.etaDate! > '2026-12-25').toBe(true);
  });

  it('a target date never unlocks intense for someone who is not eligible', () => {
    const p = computePlan(base({ weightKg: 66, heightCm: 170, targetWeightKg: 60, maintenanceKcal: 2100, targetDate: '2027-01-01' }));
    expect(p.intense).toBe(false);
    expect(-p.weeklyChangeKg).toBeLessThanOrEqual(0.75 * 0.66 + 0.01);
  });

  it('validates pace and targetDate', () => {
    expect(validateProfilePatch({ pace: 'intense' })).toEqual({ pace: 'intense' });
    expect(() => validateProfilePatch({ targetDate: '2020-01-01' })).toThrow();
    expect(validateProfilePatch({ targetDate: null })).toEqual({ targetDate: null });
  });
});

describe('intense held by the floor', () => {
  it('explains when the calorie floor makes intense no faster than fast', () => {
    const p = computePlan(base({ sex: 'male', weightKg: 98, heightCm: 172, targetWeightKg: 82, maintenanceKcal: 2590, bmr: 1940, pace: 'intense' }));
    expect(p.intense).toBe(false);
    expect(p.targetKcal).toBe(1940);
    expect(p.notices.find((n) => n.code === 'intense_unavailable')?.text_en).toMatch(/resting burn/);
  });
});
