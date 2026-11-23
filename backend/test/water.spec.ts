import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/storage/memory.repository';
import { ProfileService } from '../src/profile/profile.service';
import { WaterService } from '../src/water/water.service';
import { drinkMl, dueWaterReminder, expectedShare, maxHourMl, waterTarget } from '../src/water/water';
import { ramadanView, voluntaryFastToday } from '../src/coach/coach-math';

describe('water target', () => {
  it('by sex, pregnancy, training and heat; no target with kidney/heart conditions', () => {
    expect(waterTarget({ sex: 'female' } as any, 0).targetMl).toBe(2200);
    expect(waterTarget({ sex: 'male' } as any, 0).targetMl).toBe(3000);
    expect(waterTarget({ sex: 'female', screening: { breastfeeding: true } } as any, 0).targetMl).toBe(3100);
    const t = waterTarget({ sex: 'male', hotEnvironment: true } as any, 90);
    expect(t).toMatchObject({ workoutMl: 750, heatMl: 750, targetMl: 4500 });
    expect(waterTarget({ sex: 'male' } as any, 600).workoutMl).toBe(1500); // capped
    expect(waterTarget({ sex: 'male', conditions: ['kidney'] } as any, 0)).toMatchObject({ targetMl: null, supervised: true });
  });

  it('drink volumes, pace and fast-drinking window', () => {
    expect(drinkMl([{ grams: 350, quantity: 1, unit: 'cup' }])).toBe(350);
    expect(drinkMl([{ grams: null, quantity: 2, unit: 'cup' }])).toBe(480);
    expect(drinkMl([{ grams: null, quantity: 1, unit: 'serving' }])).toBe(250);
    expect(expectedShare(8 * 60)).toBe(0);
    expect(expectedShare(15 * 60)).toBe(0.5);
    expect(maxHourMl([{ at: '2026-11-23T08:00:00Z', ml: 800 }, { at: '2026-11-23T08:40:00Z', ml: 800 }, { at: '2026-11-23T10:00:00Z', ml: 500 }])).toBe(1600);
  });

  it('reminds only when behind, never while fasting', () => {
    const base = { intakeMl: 600, expectedMl: 1400, targetMl: 2200, fasting: false, fastDay: false, iftarMin: null, lang: 'en' };
    expect(dueWaterReminder({ ...base, nowMin: 14 * 60 + 5 })?.key).toBe('water:14');
    expect(dueWaterReminder({ ...base, nowMin: 14 * 60 + 5, intakeMl: 1100 })).toBeNull();
    expect(dueWaterReminder({ ...base, nowMin: 13 * 60 })).toBeNull();
    expect(dueWaterReminder({ ...base, nowMin: 14 * 60 + 5, fasting: true })).toBeNull();
    expect(dueWaterReminder({ ...base, nowMin: 20 * 60 + 10, fastDay: true, iftarMin: 18 * 60 })?.key).toBe('water:iftar');
  });

  it('service: taps + drinks + Apple Health, undo, and warnings', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    await profiles.update('u', { sex: 'female', timezone: 'Asia/Dubai' });
    const w = new WaterService(repo, profiles);
    const date = '2026-11-20';
    let d = await w.add('u', { ml: 500, date, at: '2026-11-20T06:00:00Z' });
    d = await w.add('u', { ml: 1200, date, at: '2026-11-20T06:30:00Z' });
    await w.ingest('u', [{ date, ml: 300 }]);
    await repo.saveMeal({ id: 'm1', userId: 'u', date, status: 'confirmed', eatenAt: '2026-11-20T09:00:00Z', createdAt: '2026-11-20T09:00:00Z',
      final: { kind: 'drink', meal_name: 'Latte', meal_name_ar: 'لاتيه', items: [{ grams: 250, quantity: 1, unit: 'cup' }], totals: {} } } as any);
    d = await w.day('u', date);
    expect(d).toMatchObject({ targetMl: 2200, manualMl: 1700, healthMl: 300, drinksMl: 250, intakeMl: 2250, remainingMl: 0 });
    expect(d.notes.map((n) => n.code)).toContain('too_fast');
    const after = await w.remove('u', d.entries[1].id);
    expect(after.manualMl).toBe(500);
    await expect(w.add('u', { ml: 5 })).rejects.toThrow();
  });
});

describe('voluntary fasting days', () => {
  const tz = 'Asia/Dubai';
  it('weekly days outside Ramadan, white days, never on Eid / Tashreeq', () => {
    // 2026-11-23 is a Monday
    const mon = new Date('2026-11-23T08:00:00Z');
    expect(voluntaryFastToday({ fastDays: [1, 4] }, mon, tz)).toBe('weekday');
    expect(voluntaryFastToday({ fastDays: [4] }, mon, tz)).toBeNull();
    const v = ramadanView({ enabled: null, suhoorTime: '04:45', iftarTime: '17:35', fastDays: [1, 4] }, mon, tz, 1800);
    expect(v).toMatchObject({ active: true, kind: 'weekday', fasting: true });
    expect(v.split).toBeTruthy();
    // Eid al-Adha 2026 (10 Dhu al-Hijjah 1447) falls on 2026-05-27 — a Wednesday
    const eid = new Date('2026-05-27T08:00:00Z');
    expect(voluntaryFastToday({ fastDays: [0, 1, 2, 3, 4, 5, 6] }, eid, tz)).toBeNull();
    // inside Ramadan 1447 (Feb–Mar 2026) a weekday setting doesn't change the kind
    const ram = ramadanView({ enabled: null, suhoorTime: '04:45', iftarTime: '18:00', fastDays: [0, 1, 2, 3, 4, 5, 6] }, new Date('2026-03-02T08:00:00Z'), tz, 1800);
    expect(ram.kind).toBe('ramadan');
  });

  it('profile keeps fasting days when other Ramadan fields change', async () => {
    const profiles = new ProfileService(new MemoryRepository());
    await profiles.update('u', { ramadan: { fastDays: [1, 4], whiteDays: true } as any });
    const p = await profiles.update('u', { ramadan: { iftarTime: '17:40' } as any });
    expect(p.ramadan).toMatchObject({ fastDays: [1, 4], whiteDays: true, iftarTime: '17:40' });
  });
});

describe('water pace on fasting days', () => {
  it('nothing expected while fasting, then spread from iftar to suhoor', async () => {
    const { fastShare } = await import('../src/water/water.service');
    expect(fastShare(12 * 60, '05:00', '18:00')).toBe(0);
    expect(fastShare(18 * 60, '05:00', '18:00')).toBe(0);
    expect(fastShare(23 * 60 + 30, '05:00', '18:00')).toBeCloseTo(0.5, 2);
    expect(fastShare(4 * 60 + 59, '05:00', '18:00')).toBeGreaterThan(0.99);
  });
});
