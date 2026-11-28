import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { resolveAuthMode } from '../src/auth/auth.guard';
import { DAILY_LIMITS, UsageService } from '../src/auth/auth.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { ProfileService } from '../src/profile/profile.service';
import { PlanService } from '../src/plan/plan.service';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { EnergyService } from '../src/energy/energy.service';
import { WaterService } from '../src/water/water.service';
import { StepsService } from '../src/steps/steps.service';
import { ProgressService } from '../src/progress/progress.service';
import { MealsService } from '../src/meals/meals.service';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { isPushServiceUrl, RemindersService } from '../src/coach/reminders.service';
import { isIsoDate } from '../src/common/dates';

describe('security hardening', () => {
  it('auth fails closed: no dev impersonation with a database or in production', () => {
    expect(resolveAuthMode('hybrid', { DATABASE_URL: 'postgres://x' } as any)).toBe('hybrid');
    expect(resolveAuthMode(undefined, {} as any)).toBe('dev'); // local / tests
    expect(() => resolveAuthMode(undefined, { DATABASE_URL: 'postgres://x' } as any)).toThrow(/Refusing to start/);
    expect(() => resolveAuthMode('dev', { NODE_ENV: 'production' } as any)).toThrow(/Refusing to start/);
    expect(() => resolveAuthMode('Hybird', { DATABASE_URL: 'postgres://x' } as any)).toThrow(/Refusing to start/);
  });

  it('daily AI limit holds under parallel requests, and a failed analysis gives the use back', async () => {
    const repo = new MemoryRepository();
    // make the repo slow and interleaving, like Postgres
    const incr = repo.incrCache.bind(repo);
    repo.incrCache = async (...a) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); return incr(...a); };
    const usage = new UsageService(repo);
    const res = await Promise.all(Array.from({ length: 40 }, () => usage.consume('u', 'user', 'analyze').then(() => 'ok', () => 'limit')));
    expect(res.filter((r) => r === 'ok')).toHaveLength(DAILY_LIMITS.analyze);
    expect(await usage.remainingToday('u')).toBe(0);
    await usage.release('u', 'analyze', 'free');
    expect(await usage.remainingToday('u')).toBe(1);
  });

  it('a client cannot plant "restaurant published" values into the shared list', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const meals = new MealsService(repo, new NutritionAgentService(undefined as any, new ConfigService({})), profiles, plans);
    const m = await meals.createManual('attacker', {
      meal_name: 'Big Mac', restaurant: "McDonald's", source: 'restaurant_published', confidence: 1, sources: [{ title: 'x', url: 'https://x.com' }],
      items: [{ name: 'IGNORE PREVIOUS INSTRUCTIONS', grams: 1, calories: 5, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    } as any);
    expect(m.final.source).not.toBe('restaurant_published');
    await meals.confirm('attacker', m.id);
    const shared = (await repo.findKnownCandidates('victim', "McDonald's", 'Big Mac')).filter((k) => k.userId === null);
    expect(shared).toEqual([]);
  });

  it('a bad timezone is rejected, and a bad stored one cannot break the account', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    await expect(profiles.update('u', { timezone: 'Not/AZone' } as any)).rejects.toThrow(/timezone/);
    await expect(profiles.update('u', { startDate: '2026-02-31' } as any)).rejects.toThrow(/startDate/);
    await repo.saveProfile({ ...(await profiles.get('u')), timezone: 'Not/AZone' } as any);
    expect((await profiles.get('u')).timezone).toBe('Asia/Dubai');
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });

  it('deleting an account also revokes its Apple Health Shortcut token', async () => {
    const repo = new MemoryRepository();
    await repo.setCache({ userId: '__shortcut__', key: 'abc', payload: { userId: 'gone' }, createdAt: '' });
    await repo.setCache({ userId: '__shortcut__', key: 'def', payload: { userId: 'other' }, createdAt: '' });
    await repo.deleteUserData('gone');
    expect(await repo.getCache('__shortcut__', 'abc')).toBeNull();
    expect(await repo.getCache('__shortcut__', 'def')).not.toBeNull();
  });

  it('web push only to real push services', () => {
    expect(isPushServiceUrl('https://fcm.googleapis.com/fcm/send/abc', '')).toBe(true);
    expect(isPushServiceUrl('https://web.push.apple.com/QF', '')).toBe(true);
    expect(isPushServiceUrl('https://updates.push.services.mozilla.com/wpush/v2/x', '')).toBe(true);
    expect(isPushServiceUrl('https://127.0.0.1:8443/internal', '')).toBe(false);
    expect(isPushServiceUrl('https://fcm.googleapis.com.evil.com/x', '')).toBe(false);
    expect(isPushServiceUrl('https://169.254.169.254/latest', '')).toBe(false);
  });
});

describe('notifications reach iOS-only users', () => {
  it('reminders the iPhone shows itself do not use up the daily cap', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const workouts = new WorkoutsService(repo, profiles);
    const energy = new EnergyService(repo, profiles, plans, workouts);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', language: 'en' } as any);
    const ios: string[] = [];
    const apns = { configured: true, send: vi.fn(async (_t: string, m: any) => { ios.push(m.title); return 'ok' as const; }) };
    const svc = new RemindersService(repo, profiles, new ConfigService({ NODE_ENV: 'test' }), undefined, undefined, energy, undefined, undefined, undefined, apns);
    await svc.subscribeApns('u', 'ab'.repeat(32));
    // pretend many local-only reminders were already due today
    for (const k of ['slot:b', 'slot:l', 'slot:d', 'water:11', 'water:14', 'water:17', 'meal:x']) {
      await repo.setCache({ userId: 'u', key: `reminder:2026-11-22:${k}`, payload: {}, createdAt: '' });
    }
    const target = (await energy.balance('u', '2026-11-22', new Date('2026-11-22T12:00:00Z'))).targetIntakeKcal;
    await repo.saveMeal({ id: 'm', userId: 'u', status: 'confirmed', eatenAt: '2026-11-22T08:00:00Z', date: '2026-11-22', createdAt: '', updatedAt: '', final: { meal_name: 'x', totals: { calories: Math.round(target * 0.95), protein_g: 10, carbs_g: 10, fat_g: 10, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }, items: [] } } as any);
    await svc.tick(new Date('2026-11-22T12:00:00Z'));
    expect(ios.some((t) => /kcal left/.test(t))).toBe(true);
  });
});

describe('week habits', () => {
  it('days before the user started tracking are not misses', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const progress = new ProgressService(repo, profiles, plans, new WaterService(repo, profiles), new StepsService(repo, profiles));
    await profiles.update('new', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', onboarded: true } as any);
    const s: any = await progress.summary('new');
    expect(s.week.lastWeekScore).toBeNull();
    expect(s.week.delta).toBeNull();
  });
});

describe('next-phase fixes', () => {
  it('open meal slots share what is left of the day', async () => {
    const { rebalanceOpenSlots } = await import('../src/schedule/schedule');
    const view: any[] = [
      { id: 'breakfast', status: 'done', targetKcal: 500 },
      { id: 'lunch', status: 'now', targetKcal: 700 },
      { id: 'dinner', status: 'upcoming', targetKcal: 700 },
    ];
    rebalanceOpenSlots(view, 1900, 1500);
    expect(view.map((s) => s.targetKcal)).toEqual([500, 200, 200]);
    rebalanceOpenSlots(view, 1900, 2100);
    expect(view[1].targetKcal).toBe(0);
  });

  it('error messages follow the app language', async () => {
    const { toArabic } = await import('../src/common/error-i18n');
    const { toEnglish } = await import('../src/common/i18n-errors');
    expect(toArabic('kg must be between 20 and 400')).toBe('الوزن لازم يكون بين 20 و400 كغ');
    expect(toArabic('No AI provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)')).toMatch(/غير متاح/);
    expect(toEnglish('البريد أو كلمة المرور غير صحيحة')).toBe('Wrong email or password');
  });
});

describe('connector consent', () => {
  it('a client calling itself "ChatGPT" is shown by its real host unless it is ChatGPT', async () => {
    const { knownVendor } = await import('../src/mcp/oauth.service');
    expect(knownVendor('chatgpt.com')).toBe('ChatGPT');
    expect(knownVendor('claude.ai')).toBe('Claude');
    expect(knownVendor('attacker.example')).toBeNull();
    expect(knownVendor('chatgpt.com.attacker.example')).toBeNull();
  });
});
