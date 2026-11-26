import { validateMeds } from '../meds/meds';
import { validateSchedule } from '../schedule/schedule';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CONDITIONS, DIET_STYLES, Profile } from '../common/types';
import { REPOSITORY, Repository } from '../storage/repository';

/** Today customisation: big ring options and tile catalogue (web + iOS render the same ids). */
export const TODAY_HEROES = ['rings', 'left', 'protein', 'water', 'steps', 'week_budget', 'week_protein'];
export const TODAY_TILES = ['steps', 'water', 'sleep', 'recovery', 'strain', 'burn', 'protein', 'carbs', 'fat', 'fiber', 'week_budget', 'week_protein', 'week_water', 'week_steps'];
export const DEFAULT_TODAY_LAYOUT = { hero: 'rings', tiles: ['steps', 'water', 'sleep', 'burn'] };

export const DEFAULT_PROFILE = (userId: string): Profile => ({
  userId,
  sex: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
  activityLevel: 'light',
  goal: 'maintain',
  goalDeltaKcal: 0,
  preferredEnergySource: null,
  timezone: 'Asia/Dubai',
  city: null,
  country: 'AE',
  targetWeightKg: null,
  pace: 'moderate',
  startWeightKg: null,
  startDate: null,
  screening: {},
  onboarded: false,
  ramadan: { enabled: null, suhoorTime: '04:45', iftarTime: '18:00' },
  reminders: { meals: true, weight: true, water: true },
  language: 'en',
  activityCalibration: null,
});

export const ACTIVITY_FACTOR: Record<Profile['activityLevel'], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

@Injectable()
export class ProfileService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async get(userId: string): Promise<Profile> {
    const stored = await this.repo.getProfile(userId);
    // merge with defaults so profiles saved before newer fields existed stay valid
    return { ...DEFAULT_PROFILE(userId), ...(stored ?? {}), userId };
  }

  async update(userId: string, patch: Partial<Profile>, opts: { system?: boolean } = {}): Promise<Profile> {
    const systemFields = opts.system && 'activityCalibration' in patch ? { activityCalibration: patch.activityCalibration } : {};
    patch = { ...validateProfilePatch(patch), ...systemFields };
    const current = await this.get(userId);
    const next: Profile = { ...current, ...stripUndefined(patch), userId };
    if (patch.goal && patch.goalDeltaKcal === undefined) {
      next.goalDeltaKcal = patch.goal === 'lose' ? -500 : patch.goal === 'gain' ? 300 : 0;
    }
    if (patch.screening) next.screening = { ...current.screening, ...patch.screening };
    if (patch.ramadan) next.ramadan = { ...current.ramadan, ...stripUndefined(patch.ramadan) } as Profile['ramadan'];
    await this.repo.saveProfile(next);
    return next;
  }
}

/** Mifflin-St Jeor BMR. Returns null when the profile is incomplete. */
/** Age in whole years — exact when a birth date is known, else from the birth year. */
export function ageOf(p: Pick<Profile, 'birthYear' | 'birthDate'>, today = new Date()): number | null {
  if (p.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) {
    const [y, m, d] = p.birthDate.split('-').map(Number);
    let age = today.getFullYear() - y;
    if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
    return age;
  }
  return p.birthYear ? today.getFullYear() - p.birthYear : null;
}

export function bmrKcal(p: Profile, today = new Date()): number | null {
  const age = ageOf(p, today);
  if (!p.weightKg || !p.heightCm || age == null || !p.sex) return null;
  return Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161));
}

/** Estimated total daily energy expenditure when no wearable data exists. */
export function estimatedTdee(p: Profile): number | null {
  const bmr = bmrKcal(p);
  return bmr == null ? null : Math.round(bmr * ACTIVITY_FACTOR[p.activityLevel]);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const ENUMS: Partial<Record<keyof Profile, readonly string[]>> = {
  sex: ['male', 'female'],
  activityLevel: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  goal: ['lose', 'maintain', 'gain'],
  pace: ['relaxed', 'moderate', 'fast', 'intense'],
  dietStyle: DIET_STYLES,
  preferredEnergySource: ['whoop', 'apple_health', 'health_connect', 'garmin', 'fitbit', 'manual'],
};
const RANGES: Partial<Record<keyof Profile, [number, number]>> = {
  birthYear: [1900, new Date().getFullYear()],
  heightCm: [100, 250],
  weightKg: [25, 350],
  mealsPerDay: [1, 6],
  targetWeightKg: [25, 350],
  startWeightKg: [25, 350],
  goalDeltaKcal: [-1500, 1500],
};

/** Rejects out-of-range or unknown enum values; null clears a field. */
export function validateProfilePatch(patch: Partial<Profile>): Partial<Profile> {
  const out: any = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'userId' || v === undefined) continue;
    const key = k as keyof Profile;
    if (ENUMS[key]) {
      if (v !== null && !ENUMS[key]!.includes(String(v))) throw new BadRequestException(`invalid ${k}`);
      out[k] = v;
    } else if (RANGES[key]) {
      if (v === null || v === '') { out[k] = null; continue; }
      const n = Number(v);
      const [lo, hi] = RANGES[key]!;
      if (!Number.isFinite(n) || n < lo || n > hi) throw new BadRequestException(`${k} must be between ${lo} and ${hi}`);
      out[k] = n;
    } else if (k === 'screening') {
      const sc = (v ?? {}) as Record<string, unknown>;
      out.screening = Object.fromEntries(
        ['pregnant', 'breastfeeding', 'medicalSupervision', 'edHistory'].filter((x) => x in sc).map((x) => [x, !!sc[x]]),
      );
    } else if (k === 'ramadan') {
      const r = (v ?? {}) as Record<string, unknown>;
      const time = (t: unknown, d: string) => {
        if (t === undefined) return undefined; // keep the saved value
        if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new BadRequestException('ramadan times must be HH:MM');
        return t;
      };
      out.ramadan = {
        enabled: r.enabled === undefined ? undefined : r.enabled === null ? null : !!r.enabled,
        suhoorTime: time(r.suhoorTime, '04:45'),
        iftarTime: time(r.iftarTime, '18:00'),
        // omitted → kept as they are (merged in update)
        fastDays: Array.isArray(r.fastDays) ? [...new Set(r.fastDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : undefined,
        whiteDays: r.whiteDays === undefined ? undefined : !!r.whiteDays,
      };
    } else if (k === 'reminders') {
      const r = (v ?? {}) as Record<string, unknown>;
      out.reminders = { meals: r.meals !== false, weight: r.weight !== false, water: r.water !== false };
    } else if (k === 'birthDate') {
      if (v === null || v === '') { out.birthDate = null; continue; }
      const s = String(v);
      const y = Number(s.slice(0, 4));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || y < 1900 || Date.parse(`${s}T00:00:00Z`) > Date.now())
        throw new BadRequestException('birthDate must be YYYY-MM-DD in the past');
      out.birthDate = s;
      out.birthYear = y;
    } else if (k === 'targetDate') {
      if (v === null || v === '') { out.targetDate = null; continue; }
      const s = String(v);
      const t = Date.parse(`${s}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(t) || t < Date.now() - 86400000 || t > Date.now() + 3 * 365 * 86400000)
        throw new BadRequestException('targetDate must be YYYY-MM-DD within the next 3 years');
      out.targetDate = s;
    } else if (k === 'conditions') {
      const list = Array.isArray(v) ? v.map(String) : [];
      if (list.some((c) => !(CONDITIONS as readonly string[]).includes(c))) throw new BadRequestException('invalid conditions');
      out.conditions = [...new Set(list)];
    } else if (k === 'language') {
      if (v !== 'en' && v !== 'ar') throw new BadRequestException('language must be en or ar');
      out.language = v;
    } else if (k === 'medReminders') {
      out.medReminders = validateMeds(v);
    } else if (k === 'mealSchedule') {
      try {
        out.mealSchedule = validateSchedule(v);
      } catch (e: any) {
        throw new BadRequestException(e.message);
      }
    } else if (k === 'todayLayout') {
      const r = (v ?? {}) as { hero?: unknown; tiles?: unknown };
      const hero = String(r.hero ?? 'rings');
      if (!TODAY_HEROES.includes(hero)) throw new BadRequestException(`todayLayout.hero must be one of ${TODAY_HEROES.join(', ')}`);
      const tiles = Array.isArray(r.tiles) ? [...new Set(r.tiles.map(String))] : [];
      const bad = tiles.find((t) => !TODAY_TILES.includes(t));
      if (bad) throw new BadRequestException(`unknown tile ${bad}`);
      out.todayLayout = { hero, tiles: tiles.slice(0, 12) };
    } else if (k === 'hotEnvironment') {
      out.hotEnvironment = !!v;
    } else if (k === 'aiConsent') {
      // Third-party AI processing consent (App Store 5.1.2(i)); the server stamps the time.
      out.aiConsentAt = v ? new Date().toISOString() : null;
    } else if (k === 'onboarded') {
      out.onboarded = !!v;
    } else if (['timezone', 'city', 'area', 'country', 'startDate'].includes(k)) {
      out[k] = v === null ? null : String(v).slice(0, 64);
    }
  }
  return out;
}
