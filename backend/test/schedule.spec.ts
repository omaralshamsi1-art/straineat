import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { RemindersService } from '../src/coach/reminders.service';
import { MealsService } from '../src/meals/meals.service';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService } from '../src/profile/profile.service';
import { ScheduleService } from '../src/schedule/schedule.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { buildDay, classifyMeal, defaultSchedule, dueSlotReminders, ramadanSchedule, slotTargets, toMin, validateSchedule } from '../src/schedule/schedule';

const est = (name: string, kcal: number, items: string[] = [name], unit = 'serving') => ({
  meal_name: name, meal_name_ar: name, items: items.map((n) => ({ name: n, name_ar: n, unit } as any)), totals: { calories: kcal } as any,
});

describe('meal kinds', () => {
  it('tells drinks, snacks and meals apart', () => {
    expect(classifyMeal(est('Spanish latte', 220))).toBe('drink');
    expect(classifyMeal(est('كرك', 120))).toBe('drink');
    expect(classifyMeal(est('Orange juice', 140, ['juice'], 'ml'))).toBe('drink');
    expect(classifyMeal(est('Latte and croissant', 480, ['latte', 'croissant']))).toBe('meal');
    expect(classifyMeal(est('Ribeye steak', 650))).toBe('meal'); // "steak" is not "tea"
    expect(classifyMeal(est('Protein bar', 210))).toBe('snack');
    expect(classifyMeal(est('تمر ولوز', 330))).toBe('snack');
    expect(classifyMeal(est('Chicken shawarma', 750))).toBe('meal');
    expect(classifyMeal(est('شوفان باللبن والتوت', 380))).toBe('meal'); // laban here is food, not a drink
    expect(classifyMeal(est('Cereal with milk', 280, ['cereal', 'milk']))).toBe('snack');
    expect(classifyMeal(est('حليب', 150))).toBe('drink');
  });
});

describe('schedule', () => {
  it('builds a default plan from meals per day and learned times', () => {
    expect(defaultSchedule(3, {}).slots.map((s) => `${s.id}@${s.time}`)).toEqual(['breakfast@08:00', 'lunch@13:30', 'dinner@19:30']);
    const five = defaultSchedule(5, { breakfast: 7 * 60 + 10 });
    expect(five.slots.map((s) => s.id)).toEqual(['breakfast', 'snack1', 'lunch', 'snack2', 'dinner']);
    expect(five.slots[0].time).toBe('07:15');
    expect(defaultSchedule(2, {}).slots).toHaveLength(2);
    expect(ramadanSchedule('04:45', '18:10').slots.map((s) => `${s.id}@${s.time}`)).toEqual(['suhoor@04:00', 'iftar@18:10', 'evening@21:15']);
  });
  it('validates custom schedules', () => {
    expect(validateSchedule({ slots: [{ id: 'lunch', time: '14:00' }, { id: 'snack2', time: '17:00' }] })).toEqual({
      custom: true, slots: [{ id: 'lunch', kind: 'meal', time: '14:00' }, { id: 'snack2', kind: 'snack', time: '17:00' }],
    });
    expect(() => validateSchedule({ slots: [{ id: 'lunch', time: '25:00' }] })).toThrow();
    expect(() => validateSchedule({ slots: [{ id: 'x', time: '10:00' }] })).toThrow();
  });
  it('splits the target: snacks ~10%, lunch biggest', () => {
    const t = slotTargets(defaultSchedule(4, {}).slots, 2000);
    expect(t.snack2).toBe(200);
    expect(t.lunch).toBeGreaterThan(t.dinner);
    expect(t.breakfast + t.lunch + t.dinner + t.snack2).toBeGreaterThanOrEqual(1980);
  });
  it('places meals and snacks in slots; drinks never count; statuses follow the clock', () => {
    const slots = defaultSchedule(4, {}).slots;
    const meal = (id: string, name: string, kcal: number, hm: string) => ({ id, status: 'confirmed', final: est(name, kcal) as any, eatenAt: hm } as any);
    const meals = [meal('1', 'Spanish latte', 220, '08:10'), meal('2', 'Eggs & toast', 420, '08:30'), meal('3', 'Protein bar', 200, '15:30')];
    const day = buildDay(slots, slotTargets(slots, 2000), meals, toMin('15:40'), (m: any) => toMin(m.eatenAt));
    const by = Object.fromEntries(day.slots.map((s) => [s.id, s]));
    expect(by.breakfast.status).toBe('done');
    expect(by.breakfast.items.map((i) => i.name)).toEqual(['Eggs & toast']);
    expect(by.snack2.items.map((i) => i.name)).toEqual(['Protein bar']); // only snack slot
    expect(by.lunch.status).toBe('missed');
    expect(by.dinner.status).toBe('upcoming');
    expect(day.drinks.map((d) => d.name)).toEqual(['Spanish latte']);
    expect(day.drinksKcal).toBe(220);
  });
  it('reminds before each slot and after a missed meal, quiet at night, none while fasting except iftar', () => {
    const slots = defaultSchedule(3, {}).slots;
    const t = slotTargets(slots, 2000);
    const at = (hm: string) => buildDay(slots, t, [], toMin(hm), () => 0).slots;
    expect(dueSlotReminders(at('13:25'), toMin('13:25'), 'ar', { fasting: false }).map((r) => r.key)).toEqual(['slot:lunch:before']);
    expect(dueSlotReminders(at('13:25'), toMin('13:25'), 'ar', { fasting: false })[0].body).toContain(String(t.lunch));
    expect(dueSlotReminders(at('14:40'), toMin('14:40'), 'en', { fasting: false }).map((r) => r.key)).toEqual(['slot:lunch:missed']);
    expect(dueSlotReminders(at('13:25'), toMin('13:25'), 'en', { fasting: true })).toEqual([]);
    const ram = ramadanSchedule('04:45', '18:10').slots;
    const rv = buildDay(ram, slotTargets(ram, 2000, { suhoor: 600, iftar: 900, evening: 500 }), [], toMin('18:05'), () => 0).slots;
    expect(dueSlotReminders(rv, toMin('18:05'), 'ar', { fasting: true }).map((r) => r.key)).toEqual(['slot:iftar:before']);
  });
  it('a skipped slot shows as skipped and gets no reminders', () => {
    const slots = defaultSchedule(3, {}).slots;
    const v = buildDay(slots, slotTargets(slots, 2000), [], toMin('14:40'), () => 0, ['lunch', 'breakfast']).slots;
    expect(v.find((s) => s.id === 'breakfast')!.status).toBe('skipped');
    expect(v.find((s) => s.id === 'lunch')!.status).toBe('skipped');
    expect(dueSlotReminders(v, toMin('14:40'), 'en', { fasting: false })).toEqual([]);
  });
});

describe('schedule service + reminders', () => {
  it('serves the day, counts a confirmed meal, ignores drinks, honours a custom schedule and sends slot reminders once', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const meals = new MealsService(repo, new NutritionAgentService(null, new ConfigService({})), profiles, plans);
    const schedule = new ScheduleService(repo, profiles, plans);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 70, goal: 'lose', targetWeightKg: 62, mealsPerDay: 4, language: 'ar', ramadan: { enabled: false, suhoorTime: '04:45', iftarTime: '18:00' } } as any);
    const add = async (name: string, kcal: number, iso: string) => {
      const m = await meals.createManual('u', { meal_name: name, meal_name_ar: name, eatenAt: iso, items: [{ name, name_ar: name, quantity: 1, unit: 'serving', grams: null, calories: kcal, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 2, sugar_g: 3, sodium_mg: 300 }] } as any);
      await meals.confirm('u', m.id);
      return m;
    };
    await add('Spanish latte', 220, '2026-11-21T04:05:00Z'); // 08:05 Dubai
    const eggs = await add('Eggs & toast', 430, '2026-11-21T04:20:00Z');
    const now = new Date('2026-11-21T09:25:00Z'); // 13:25 Dubai
    const d = await schedule.day('u', undefined, now);
    expect(d.slots.map((s: any) => `${s.id}:${s.status}`)).toEqual(['breakfast:done', 'lunch:now', 'snack2:upcoming', 'dinner:upcoming']);
    expect(d.slots[0].label).toBe('الفطور');
    expect(d.drinks.map((x: any) => x.name)).toEqual(['Spanish latte']);
    // the user re-labels the eggs as a snack → breakfast is no longer done
    await meals.update('u', eggs.id, { kind: 'snack' });
    expect((await meals.list('u', '2026-11-21')).find((m: any) => m.id === eggs.id)!.kind).toBe('snack');
    // custom schedule
    await profiles.update('u', { mealSchedule: { slots: [{ id: 'lunch', time: '13:30' }, { id: 'dinner', time: '20:00' }] } } as any);
    const c = await schedule.day('u', undefined, now);
    expect(c.custom).toBe(true);
    expect(c.slots.map((s: any) => s.id)).toEqual(['lunch', 'dinner']);
    await expect(profiles.update('u', { mealSchedule: { slots: [{ id: 'lunch', time: '99:00' }] } } as any)).rejects.toThrow();
    // reminders
    const sent: string[] = [];
    const svc = new RemindersService(repo, profiles, new ConfigService({ NODE_ENV: 'test' }), vi.fn(async (_s: any, p: string) => { sent.push(JSON.parse(p).title); }), schedule);
    await svc.subscribe('u', { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } });
    await svc.tick(now);
    await svc.tick(new Date('2026-11-21T09:28:00Z'));
    expect(sent).toEqual(['🍽️ وقت الغداء']);
  });
});

import { kcalOf, ShortcutService } from '../src/energy/shortcut.service';
import { EnergyService } from '../src/energy/energy.service';
import { WorkoutsService } from '../src/workouts/workouts.service';

describe('Apple Health via iPhone Shortcut', () => {
  it('parses messy numbers from Shortcuts', () => {
    expect(kcalOf(512.4)).toBe(512);
    expect(kcalOf('1,240.6 kcal')).toBe(1241);
    expect(kcalOf(['200', 300.2])).toBe(500);
    expect(kcalOf('٥١٢')).toBe(512);
    expect(kcalOf('')).toBeNull();
    expect(kcalOf(-5)).toBeNull();
  });
  it('token → ingest as apple_health burn; rotate disables the old token', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const energy = new EnergyService(repo, profiles, plans, new WorkoutsService(repo, profiles));
    const sc = new ShortcutService(repo, energy, profiles);
    await profiles.update('u', { sex: 'male', birthYear: 1990, heightCm: 178, weightKg: 80, timezone: 'Asia/Dubai' } as any);
    const { token } = await sc.token('u');
    expect((await sc.token('u')).token).toBe(token); // stable
    const r = await sc.ingest(token, { active: '612.7', basal: 1680 });
    expect(r).toMatchObject({ ok: true, activeKcal: 613, basalKcal: 1680, totalKcal: 2293 });
    const b: any = await energy.balance('u', r.date);
    expect(b.burn).toMatchObject({ source: 'apple_health', totalKcal: 2293 });
    expect((await sc.status('u')).last).toMatchObject({ active: 613 });
    await expect(sc.ingest('x'.repeat(24), { active: 1 })).rejects.toThrow('Invalid sync token');
    await expect(sc.ingest(token, {})).rejects.toThrow();
    const { token: t2 } = await sc.token('u', true);
    expect(t2).not.toBe(token);
    await expect(sc.ingest(token, { active: 100 })).rejects.toThrow('Invalid sync token');
    await expect(sc.ingest(t2, { active: 100 })).resolves.toMatchObject({ ok: true });
  });
});
