import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { activityNudges, calorieNudge, journeyLevel, milestoneNudge, proteinNudge, weeklyNudge, isLocalOnIos } from '../src/coach/nudges';
import { apnsJwt } from '../src/push/apns';
import { MemoryRepository } from '../src/storage/memory.repository';
import { ProfileService } from '../src/profile/profile.service';
import { PlanService } from '../src/plan/plan.service';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { EnergyService } from '../src/energy/energy.service';
import { RemindersService } from '../src/coach/reminders.service';

const now = new Date('2026-11-22T12:00:00Z');
const w = (o: any = {}) => ({ id: 'whoop:1', sportAr: 'مشي', sportEn: 'Walking', end: '2026-11-22T11:30:00Z', durationMin: 25, kcal: 140, ...o });

describe('essential notifications (pure)', () => {
  it('activity: ≥10 min, within 3 h, shows what is left', () => {
    expect(activityNudges({ now, workouts: [w()], remainingKcal: 640, fasting: false, lang: 'ar' })).toEqual([{ key: 'wo:whoop:1', title: 'مشي · 140 سعرة 🔥', body: 'صار باقي لك اليوم 640 سعرة.' }]);
    expect(activityNudges({ now, workouts: [w({ durationMin: 8 })], remainingKcal: 640, fasting: false, lang: 'ar' })).toEqual([]);
    expect(activityNudges({ now, workouts: [w({ end: '2026-11-22T08:00:00Z' })], remainingKcal: 640, fasting: false, lang: 'en' })).toEqual([]);
    // manual entry added 10 min ago for a walk this morning
    expect(activityNudges({ now, workouts: [w({ end: '2026-11-22T05:00:00Z', source: 'manual', updatedAt: '2026-11-22T11:50:00Z', kcal: null })], remainingKcal: -50, fasting: false, lang: 'en' })[0])
      .toMatchObject({ title: 'Walking · 25 min 🔥', body: "You've reached today's calorie target — this helps you stay on track." });
  });
  it('calories: only the highest stage; no "over" for gain; nothing while fasting', () => {
    expect(calorieNudge({ eatenKcal: 1500, targetKcal: 1800, goal: 'lose', fasting: false, lang: 'en' })).toBeNull();
    expect(calorieNudge({ eatenKcal: 1640, targetKcal: 1800, goal: 'lose', fasting: false, lang: 'ar' })?.title).toBe('باقي لك 160 سعرة بس');
    expect(calorieNudge({ eatenKcal: 1850, targetKcal: 1800, goal: 'lose', fasting: false, lang: 'en' })?.key).toBe('kcal:100');
    expect(calorieNudge({ eatenKcal: 2100, targetKcal: 1800, goal: 'lose', fasting: false, lang: 'en' })?.key).toBe('kcal:115');
    expect(calorieNudge({ eatenKcal: 2100, targetKcal: 1800, goal: 'gain', fasting: false, lang: 'en' })?.key).toBe('kcal:100');
    expect(calorieNudge({ eatenKcal: 2100, targetKcal: 1800, goal: 'lose', fasting: true, lang: 'en' })).toBeNull();
  });
  it('protein: evening only, after a meal, under 70 %', () => {
    const base = { nowMin: 19 * 60 + 15, proteinG: 60, targetG: 120, mealsToday: 2, fasting: false, lang: 'ar' };
    expect(proteinNudge(base)).toMatchObject({ key: 'protein', title: 'ناقصك 60 غ بروتين 💪' });
    expect(proteinNudge({ ...base, proteinG: 90 })).toBeNull();
    expect(proteinNudge({ ...base, nowMin: 17 * 60 })).toBeNull();
    expect(proteinNudge({ ...base, mealsToday: 0 })).toBeNull();
  });
  it('weekly: Sunday 20:00–21:30', () => {
    const week = { score: 72, lastWeekScore: 64, delta: 8, weakest: { habit: 'water' } };
    expect(weeklyNudge({ weekday: 0, nowMin: 20 * 60 + 5, week, lang: 'en' })).toEqual({ key: 'week', title: 'Week score: 72/100 📅', body: 'Your result (+8 vs last week). Next week, focus on water.' });
    expect(weeklyNudge({ weekday: 1, nowMin: 20 * 60 + 5, week, lang: 'en' })).toBeNull();
  });
  it('milestones: quarters, first sighting is silent', () => {
    expect(journeyLevel(0.49)).toBe(1);
    expect(journeyLevel(1.02)).toBe(4);
    expect(milestoneNudge({ level: 2, prevLevel: null, targetKg: 62, currentKg: 66, lang: 'en' })).toBeNull();
    expect(milestoneNudge({ level: 2, prevLevel: 1, targetKg: 62, currentKg: 66, lang: 'en' })?.title).toBe('50% of your journey done 🏁');
    expect(milestoneNudge({ level: 4, prevLevel: 3, targetKg: 62, currentKg: 62, lang: 'ar' })?.key).toBe('goal:reached');
  });
  it('the iOS app keeps its own meal / water / medicine reminders', () => {
    expect(isLocalOnIos('slot:b:before')).toBe(true);
    expect(isLocalOnIos('water:14')).toBe(true);
    expect(isLocalOnIos('kcal:90')).toBe(false);
  });
});

describe('APNs', () => {
  it('signs an ES256 provider token Apple can verify', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const t = apnsJwt('KEY123', 'TEAM456', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 1_800_000_000);
    const [h, c, s] = t.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM456', iat: 1_800_000_000 });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('reminders: essentials end-to-end', () => {
  it('calorie stages, daily cap, iOS gets only non-local kinds', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const workouts = new WorkoutsService(repo, profiles);
    const energy = new EnergyService(repo, profiles, plans, workouts);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', targetWeightKg: 62, language: 'en', reminders: { meals: false, weight: false, water: false, protein: false } } as any);
    const web: string[] = [];
    const ios: string[] = [];
    const apns = { configured: true, send: vi.fn(async (_t: string, m: any) => { ios.push(m.title); return 'ok' as const; }) };
    const svc = new RemindersService(repo, profiles, new ConfigService({ NODE_ENV: 'test' }), vi.fn(async (_s: any, p: string) => { web.push(JSON.parse(p).title); }), undefined, energy, undefined, undefined, undefined, apns);
    await svc.subscribe('u', { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } });
    await svc.subscribeApns('u', 'ab'.repeat(32));
    await expect(svc.subscribeApns('u', 'nope')).rejects.toThrow();

    const target = (await energy.balance('u', '2026-11-22', now)).targetIntakeKcal;
    const meal = (id: string, kcal: number) => repo.saveMeal({ id, userId: 'u', status: 'confirmed', eatenAt: '2026-11-22T08:00:00Z', date: '2026-11-22', createdAt: '', updatedAt: '', final: { meal_name: id, totals: { calories: kcal, protein_g: 10, carbs_g: 10, fat_g: 10, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }, items: [] } } as any);
    await meal('m1', Math.round(target * 1.2)); // jumps straight past 115 %
    await svc.tick(now);
    await svc.tick(new Date('2026-11-22T12:05:00Z'));
    expect(web).toEqual(['A bit over target today']); // 90 % and 100 % are skipped, sent once
    expect(ios).toEqual(['A bit over target today']);
  });
});
