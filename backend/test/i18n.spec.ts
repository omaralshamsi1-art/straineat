import 'reflect-metadata';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { scoreMeal, ramadanTips } from '../src/coach/coach-math';
import { LocalizedErrorFilter, toEnglish, wantsArabic } from '../src/common/i18n-errors';
import { dailyTips } from '../src/energy/energy.service';
import { computePlan } from '../src/plan/plan-math';
import { validateProfilePatch, DEFAULT_PROFILE } from '../src/profile/profile.service';
import { sportEn } from '../src/workouts/workouts.service';
import { dueReminders } from '../src/coach/reminders.service';

const n = { calories: 500, protein_g: 40, carbs_g: 40, fat_g: 15, fiber_g: 8, sugar_g: 5, sodium_mg: 600 };

function run(e: HttpException, lang?: string) {
  let out: any; let code = 0;
  const host: any = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: lang ? { 'accept-language': lang } : {} }),
      getResponse: () => ({ status: (c: number) => ({ json: (b: any) => { code = c; out = b; } }) }),
    }),
  };
  new LocalizedErrorFilter().catch(e, host);
  return { code, out };
}

describe('i18n', () => {
  it('profile language defaults to English and only accepts en/ar', () => {
    expect(DEFAULT_PROFILE('u').language).toBe('en');
    expect(validateProfilePatch({ language: 'ar' } as any).language).toBe('ar');
    expect(() => validateProfilePatch({ language: 'fr' } as any)).toThrow();
  });

  it('deterministic texts come in both languages', () => {
    const s = scoreMeal(n, { goal: 'lose', remainingBeforeKcal: 900, dailyTargetKcal: 1800 });
    expect(s.label_en).toBeTruthy();
    expect(s.reasons.every((r) => r.text_ar && r.text_en)).toBe(true);
    const tips = dailyTips({ intake: { calories: 0, protein_g: 0, fiber_g: 0 }, target: 1800, macroTargets: { protein_g: 120, fiber_g: 25 }, goal: 'lose', isToday: true, hour: 15, mealsCount: 0 });
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every((t) => t.text_en && !/[؀-ۿ]/.test(t.text_en))).toBe(true);
    const r = ramadanTips({ active: true, kind: 'ramadan', detected: true, needsChoice: false, fasting: true, suhoorTime: '04:45', iftarTime: '18:00', split: { suhoor: 500, iftar: 800, evening: 400 }, minutesToIftar: 75 }, 0);
    expect(r[0].text_en).toContain('1 h 15 min');
    const p = computePlan({ goal: 'lose', pace: 'fast', sex: 'female', age: 36, heightCm: 165, weightKg: 70, targetWeightKg: 40, maintenanceKcal: 2000, maintenanceSource: 'formula', bmr: 1400, screening: { medicalSupervision: true } });
    expect(p.notices.length).toBeGreaterThan(0);
    expect(p.notices.every((x) => x.text_en && !/[؀-ۿ]/.test(x.text_en))).toBe(true);
  });

  it('sport names get English labels', () => {
    expect(sportEn('functional-fitness')).toBe('Functional fitness');
    expect(sportEn('HIIT')).toBe('HIIT');
    expect(sportEn('TraditionalStrengthTraining')).toBe('Strength training');
  });

  it('reminders follow the profile language', () => {
    const base = { nowMin: 8 * 60, usual: {}, loggedSlotsToday: new Set<any>(), daysSinceWeight: null, fasting: false, prefs: { meals: true, weight: true } };
    expect(dueReminders({ ...base }).map((r) => r.title)).toEqual(['Morning weigh-in ⚖️']);
    expect(dueReminders({ ...base, lang: 'ar' }).map((r) => r.title)).toEqual(['قياس الصباح ⚖️']);
  });

  it('error messages are English unless the client asks for Arabic', () => {
    expect(wantsArabic('ar-AE,ar;q=0.9')).toBe(true);
    expect(wantsArabic('en-US')).toBe(false);
    const e = new BadRequestException('رمز الدعوة غير صالح أو منتهي');
    expect(run(e).out.message).toBe('Invite code is invalid or expired');
    expect(run(e, 'en').code).toBe(400);
    expect(run(e, 'ar').out.message).toBe('رمز الدعوة غير صالح أو منتهي');
    expect(toEnglish('وصلت للحد اليومي لطلبات المدرب (12).')).toBe('Daily coach limit reached (12).');
    expect(run(new HttpException('محاولات كثيرة، حاول بعد 15 دقيقة', HttpStatus.TOO_MANY_REQUESTS)).out).toMatchObject({ statusCode: 429, message: 'Too many attempts — try again in 15 minutes' });
  });
});
