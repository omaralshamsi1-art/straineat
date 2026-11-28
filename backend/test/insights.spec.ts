import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { burnBonus, morningCard, todayCards, workoutCard } from '../src/insights/insights';
import { RemindersService } from '../src/coach/reminders.service';
import { EnergyService } from '../src/energy/energy.service';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService } from '../src/profile/profile.service';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const TZ = 'Asia/Dubai';

describe('extra-burn allowance', () => {
  it('adds back half of the extra, only above 100 kcal, capped, never negative', () => {
    // a finished day: 2400 burned vs 2000 expected → +200
    expect(burnBonus({ burnKcal: 2400, expectedKcal: 2000, partialDay: false, minuteOfDay: 0 }).bonusKcal).toBe(200);
    // at noon: 1500 so far + half a day at the expected rate (1200) = 2700 projected → +150
    const noon = burnBonus({ burnKcal: 1500, expectedKcal: 2400, partialDay: true, minuteOfDay: 720 });
    expect(noon.projectedKcal).toBe(2700);
    expect(noon.bonusKcal).toBe(150);
    // a normal day changes nothing
    expect(burnBonus({ burnKcal: 2050, expectedKcal: 2000, partialDay: false, minuteOfDay: 0 }).bonusKcal).toBe(0);
    expect(burnBonus({ burnKcal: 1500, expectedKcal: 2000, partialDay: false, minuteOfDay: 0 }).bonusKcal).toBe(0);
    // huge day is capped; no device data → nothing
    expect(burnBonus({ burnKcal: 6000, expectedKcal: 2000, partialDay: false, minuteOfDay: 0 }).bonusKcal).toBe(1000);
    expect(burnBonus({ burnKcal: null, expectedKcal: 2000, partialDay: true, minuteOfDay: 600 }).bonusKcal).toBe(0);
  });
});

describe('morning plan card', () => {
  it('green recovery: harder session + carbs around it, last coffee 6 h before bed, protein per meal', () => {
    const c = morningCard({ date: '2026-11-22', day: { recovery: 80, sleepMin: 558, sleepNeededMin: 480, sleepStart: '2026-11-21T19:53:00Z' }, tz: TZ, proteinTargetG: 160, ramadan: false })!;
    expect(c.tone).toBe('good');
    expect(c.title_ar).toContain('80%');
    expect(c.lines_ar).toHaveLength(3);
    expect(c.lines_ar[0]).toContain('الكارب');
    // bed 23:53 Dubai → 17:53 → rounded down to 17:30
    expect(c.lines_ar[1]).toContain('17:30');
    expect(c.lines_en[2]).toContain('160 g');
  });
  it('red recovery after a short night mentions hunger; Ramadan drops the coffee line', () => {
    const c = morningCard({ date: 'd', day: { recovery: 25, sleepMin: 300, sleepStart: '2026-11-21T20:30:00Z' }, tz: TZ, proteinTargetG: 120, ramadan: false })!;
    expect(c.tone).toBe('low');
    expect(c.lines_ar[1]).toContain('5:00');
    expect(c.lines_en[1]).toContain('hunger');
    const r = morningCard({ date: 'd', day: { recovery: 50, sleepMin: 450, sleepStart: '2026-11-21T20:30:00Z' }, tz: TZ, proteinTargetG: 120, ramadan: true })!;
    expect(r.lines_en.join(' ')).not.toContain('coffee');
    expect(r.lines_en.join(' ')).toContain('iftar and suhoor');
    expect(morningCard({ date: 'd', day: {}, tz: TZ, proteinTargetG: 120, ramadan: false })).toBeNull();
  });
});

describe('after-workout card', () => {
  const ride = { id: 'whoop:1', sportAr: 'دراجة', sportEn: 'Cycling', end: '2026-11-22T13:00:00Z', durationMin: 71, kcal: 825, strain: 14.3 };
  it('protein for the body weight, carbs after a long or hard session, and the budget bonus', () => {
    const c = workoutCard({ workout: ride, weightKg: 75, bonusKcal: 150, fasting: false })!;
    expect(c.id).toBe('wo:whoop:1');
    expect(c.title_ar).toBe('خلصت دراجة · 71 د · 825 سعرة');
    expect(c.lines_ar[0]).toContain('25 غ بروتين'); // 0.3 g/kg × 75 → 22.5 → 25
    expect(c.lines_ar[0]).toContain('كارب (رز');
    expect(c.lines_en[1]).toContain('+150 kcal');
    expect(workoutCard({ workout: ride, weightKg: 140, bonusKcal: 0, fasting: true })!.lines_ar[0]).toContain('عند الإفطار: 40 غ'); // capped at 40
    expect(workoutCard({ workout: { ...ride, durationMin: 10, kcal: 40 }, weightKg: 75, bonusKcal: 0, fasting: false })).toBeNull();
  });
  it('today: a workout from the last 3 h comes first; the morning plan only until 15:00', () => {
    const base = { date: '2026-11-22', tz: TZ, wellness: { recovery: 70, sleepMin: 480 }, workouts: [ride], weightKg: 70, proteinTargetG: 140, bonusKcal: 0, ramadan: false, fasting: false };
    expect(todayCards({ ...base, now: new Date('2026-11-22T14:00:00Z') }).map((c) => c.kind)).toEqual(['workout']); // 18:00 Dubai
    expect(todayCards({ ...base, now: new Date('2026-11-22T10:30:00Z') }).map((c) => c.kind)).toEqual(['morning']); // before the ride
    expect(todayCards({ ...base, now: new Date('2026-11-22T13:30:00Z'), wellness: null }).map((c) => c.kind)).toEqual(['workout']);
    expect(todayCards({ ...base, now: new Date('2026-11-22T17:30:00Z') })).toEqual([]); // ride ended 4.5 h ago
  });
});

describe('insight notifications', () => {
  it('sends the morning plan once, a note once per workout, and polls WHOOP at most every 20 min', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const workouts = new WorkoutsService(repo, profiles);
    const energy = new EnergyService(repo, profiles, plans, workouts);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', targetWeightKg: 62, language: 'ar', reminders: { meals: false, weight: false } } as any);
    await repo.setCache({ userId: 'u', key: 'whoop-day:2026-11-22', payload: { recovery: 80, sleepMin: 500, sleepStart: '2026-11-21T19:30:00Z' }, createdAt: '' });
    await repo.saveTokens({ userId: 'u', provider: 'whoop', accessToken: 'a', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00Z', scope: '' } as any);
    const whoop = { sync: vi.fn(async () => ({})) };
    const sent: string[] = [];
    const svc = new RemindersService(repo, profiles, new ConfigService({ NODE_ENV: 'test' }), vi.fn(async (_s: any, p: string) => { sent.push(JSON.parse(p).title); }), undefined, energy, whoop as any);
    await svc.subscribe('u', { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } });

    await svc.tick(new Date('2026-11-22T04:00:00Z')); // 08:00 Dubai
    await svc.tick(new Date('2026-11-22T04:01:00Z'));
    expect(sent).toEqual(['جاهز ليوم قوي · استشفاء 80%']);
    expect(whoop.sync).toHaveBeenCalledTimes(1);
    await svc.tick(new Date('2026-11-22T04:25:00Z'));
    expect(whoop.sync).toHaveBeenCalledTimes(2);

    // a ride that ended 20 min ago → one note
    await repo.upsertWorkout({ userId: 'u', id: 'whoop:r1', source: 'whoop', sport: 'cycling', start: '2026-11-22T08:00:00Z', end: '2026-11-22T09:10:00Z', date: '2026-11-22', durationMin: 70, kcal: 800, strain: 14, avgHr: 150, maxHr: 175, distanceM: null, zonesMin: null, updatedAt: '' });
    sent.length = 0;
    await svc.tick(new Date('2026-11-22T09:30:00Z'));
    await svc.tick(new Date('2026-11-22T09:31:00Z'));
    expect(sent).toEqual(['دراجة · 800 سعرة 🔥']); // one note per activity, with what's left today
  });
});

describe('device calibration', () => {
  it('corrects a watch that reads high and gives back more once calibrated', async () => {
    const { deviceCalibration } = await import('../src/plan/plan.service');
    const { burnBonus } = await import('../src/insights/insights');
    const c = deviceCalibration(2300, 2600, 14)!; // watch says 2600, body says 2300
    expect(c.factor).toBe(0.88);
    expect(c.accuracyPct).toBe(88);
    expect(deviceCalibration(null, 2600, 14)).toBeNull();
    // finished day: watch 3000, expected 2300
    const raw = burnBonus({ burnKcal: 3000, expectedKcal: 2300, partialDay: false, minuteOfDay: 0 });
    const cal = burnBonus({ burnKcal: 3000, expectedKcal: 2300, partialDay: false, minuteOfDay: 0, deviceFactor: 0.88 });
    expect(raw).toMatchObject({ bonusKcal: 350, share: 0.5 });
    expect(cal.extraKcal).toBe(340); // 3000 × 0.88 − 2300
    expect(cal).toMatchObject({ bonusKcal: 260, share: 0.75 });
  });
});
