import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { EnergyDay, EnergySource, Profile, WeightEntry } from '../common/types';
import { SUPERVISED_CONDITIONS } from '../common/types';
import { ageOf, bmrKcal, estimatedTdee, ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { burnBonus, localMinuteOfDay } from '../insights/insights';
import {
  ActivityLevel,
  adaptiveMaintenance,
  calibrateActivity,
  CALIBRATION_MIN_DAYS,
  CALIBRATION_WINDOW_DAYS,
  computePlan,
  Plan,
  weightTrend,
} from './plan-math';

export const SOURCE_PRIORITY: EnergySource[] = ['whoop', 'apple_health', 'health_connect', 'garmin', 'fitbit', 'manual'];

/** One burn value per day — never add devices together (double counting). */
export function pickEnergy(days: EnergyDay[], preferred: EnergySource | null): EnergyDay | null {
  const order = preferred ? [preferred, ...SOURCE_PRIORITY.filter((s) => s !== preferred)] : SOURCE_PRIORITY;
  return order.map((s) => days.find((x) => x.source === s)).find(Boolean) ?? null;
}

/** Device bias from measured vs observed burn; clamped so one odd month can't swing targets. */
export function deviceCalibration(observed: number | null, avgDevice: number | null, days: number) {
  if (observed == null || !avgDevice || days < CALIBRATION_MIN_DAYS) return null;
  const factor = Math.round(Math.min(1.2, Math.max(0.7, observed / avgDevice)) * 100) / 100;
  return { factor, accuracyPct: Math.round(100 * (1 - Math.abs(1 - factor))), days };
}

const WEIGHT_SOURCE_ORDER: WeightEntry['source'][] = ['manual', 'apple_health', 'whoop'];

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Low-carb styles move energy from carbs to fat; protein and calories stay as planned.
 * keto ≈ 30 g carbs, low-carb ≈ 25% of calories from carbs.
 */
export function applyDietStyle(plan: Plan, style?: string): void {
  if (style !== 'keto' && style !== 'low_carb') return;
  const carbs = style === 'keto' ? 30 : Math.round((plan.targetKcal * 0.25) / 4);
  const fat = Math.round((plan.targetKcal - plan.proteinG * 4 - carbs * 4) / 9);
  if (fat <= 0) return;
  plan.carbsG = carbs;
  plan.fatG = fat;
}

export interface PlanView extends Plan {
  bmr?: number | null;
  ageYears?: number | null;
  dietStyle?: string;
  currentWeightKg: number | null;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  progressPct: number | null;
  changeSinceStartKg: number | null;
  adaptiveObservedKcal: number | null;
  /**
   * How the watch's burn compares with what the body really burned (intake − weight change).
   * factor 0.9 = the device reads ~11% high for this person. Null until both are known.
   */
  deviceCalibration: { factor: number; accuracyPct: number; days: number } | null;
  targetDate: string | null;
  /** measured-burn calibration status */
  burnData: { days: number; needed: number; window: number; avgKcal: number | null };
  activityLevel: string;
  activityCalibration: Profile['activityCalibration'];
}

const LEVEL_AR: Record<string, string> = {
  sedentary: 'قليل الحركة',
  light: 'نشاط خفيف',
  moderate: 'متوسط',
  active: 'نشيط',
  very_active: 'نشيط جداً',
};
const LEVEL_EN: Record<string, string> = {
  sedentary: 'sedentary', light: 'lightly active', moderate: 'moderately active', active: 'active', very_active: 'very active',
};

@Injectable()
export class PlanService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
  ) {}

  // ---------------- weights ----------------
  async addWeight(userId: string, body: { kg: number; date?: string; source?: WeightEntry['source'] }) {
    const kg = Number(body?.kg);
    if (!Number.isFinite(kg) || kg <= 20 || kg >= 400) throw new BadRequestException('kg must be between 20 and 400');
    const profile = await this.profiles.get(userId);
    const date = body.date ?? localDate(new Date(), profile.timezone);
    if (!isIsoDate(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const source = body.source ?? 'manual';
    if (!WEIGHT_SOURCE_ORDER.includes(source)) throw new BadRequestException('invalid source');
    await this.repo.upsertWeight({ userId, date, kg: Math.round(kg * 100) / 100, source, updatedAt: new Date().toISOString() });
    const patch: Partial<Profile> = { weightKg: Math.round(kg * 10) / 10 };
    if (!profile.startWeightKg) Object.assign(patch, { startWeightKg: patch.weightKg, startDate: date });
    await this.profiles.update(userId, patch);
    return this.weights(userId, 90);
  }

  async deleteWeight(userId: string, date: string) {
    if (!isIsoDate(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.repo.deleteWeight(userId, date, 'manual');
    return this.weights(userId, 90);
  }

  /** One weight per day (manual > Apple Health > WHOOP) plus the smoothed trend. */
  async weights(userId: string, days = 90) {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    // the trend always starts from the same point (≥120 days back), so "current" doesn't change with the range asked for
    const span = Math.min(Math.max(days, 7), 730);
    const from = addDays(today, -span);
    const raw = await this.repo.listWeights(userId, addDays(today, -Math.max(span, 120)), today);
    const byDate = new Map<string, WeightEntry>();
    for (const w of raw) {
      const cur = byDate.get(w.date);
      if (!cur || WEIGHT_SOURCE_ORDER.indexOf(w.source) < WEIGHT_SOURCE_ORDER.indexOf(cur.source)) byDate.set(w.date, w);
    }
    const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const trend = weightTrend(entries.map((e) => ({ date: e.date, kg: e.kg })));
    return {
      entries: trend.map((t, i) => ({ ...t, source: entries[i].source })).filter((e) => e.date >= from),
      current: trend.length ? trend[trend.length - 1].trend : profile.weightKg,
    };
  }

  // ---------------- plan ----------------
  /** `override` lets onboarding preview a plan before saving the profile. */
  async plan(userId: string, override?: Partial<Profile>): Promise<PlanView> {
    const profile: Profile = { ...(await this.profiles.get(userId)), ...(override ?? {}), userId };
    const today = localDate(new Date(), profile.timezone);
    const w = await this.weights(userId, 60);
    const currentWeight = override?.weightKg ?? w.current ?? profile.weightKg;
    const withWeight: Profile = { ...profile, weightKg: currentWeight };
    const bmr = bmrKcal(withWeight);

    // Baseline maintenance: once ≥7 complete device days exist, use the average of the last 14
    // complete days (today is partial and excluded); before that, the formula.
    const energy = await this.repo.listEnergyRange(userId, addDays(today, -CALIBRATION_WINDOW_DAYS), addDays(today, -1));
    const perDay = new Map<string, EnergyDay[]>();
    for (const e of energy) perDay.set(e.date, [...(perDay.get(e.date) ?? []), e]);
    const minPlausible = Math.max(800, (bmr ?? 1000) * 0.8); // drop days the device was barely worn
    const deviceDays = [...perDay.values()]
      .map((d) => pickEnergy(d, profile.preferredEnergySource))
      .filter((d): d is EnergyDay => !!d && d.totalKcal >= minPlausible);
    const avgDevice = deviceDays.length ? deviceDays.reduce((a, d) => a + d.totalKcal, 0) / deviceDays.length : null;

    // Auto-correct the declared activity level from measured burn (at most once a day, saved only
    // for real reads — never for onboarding previews).
    if (!override && avgDevice && deviceDays.length >= CALIBRATION_MIN_DAYS && profile.activityCalibration?.at !== today) {
      const c = calibrateActivity(profile.activityLevel as ActivityLevel, avgDevice, bmr);
      if (c) {
        const record = { from: profile.activityLevel, to: c.to, avgBurnKcal: Math.round(avgDevice), days: deviceDays.length, factor: c.factor, at: today };
        await this.profiles.update(userId, { activityLevel: c.to, activityCalibration: record }, { system: true });
        profile.activityLevel = c.to;
        profile.activityCalibration = record;
        withWeight.activityLevel = c.to;
      }
    }

    const formula = estimatedTdee(withWeight);
    let baseline: number;
    let source: 'adaptive' | 'device' | 'formula';
    if (avgDevice && deviceDays.length >= CALIBRATION_MIN_DAYS) {
      baseline = avgDevice;
      source = 'device';
    } else {
      baseline = formula ?? 2000;
      source = 'formula';
    }

    // Adaptive correction from logged intake vs weight trend (last 28 complete days).
    const from = addDays(today, -28);
    const meals = (await this.repo.listMealsRange(userId, from, addDays(today, -1))).filter((m) => m.status === 'confirmed');
    const intakeByDay = new Map<string, number>();
    for (const m of meals) intakeByDay.set(m.date, (intakeByDay.get(m.date) ?? 0) + m.final.totals.calories);
    const adaptive = adaptiveMaintenance({
      baseline,
      loggedDays: [...intakeByDay].map(([date, kcal]) => ({ date, kcal })),
      trend: w.entries.filter((e) => e.date >= from).map((e) => ({ date: e.date, trend: e.trend })),
    });
    if (adaptive.adaptive) source = 'adaptive';

    const plan = computePlan({
      goal: profile.goal,
      pace: profile.pace ?? 'moderate',
      sex: profile.sex,
      age: ageOf(profile),
      heightCm: profile.heightCm,
      weightKg: currentWeight,
      targetWeightKg: profile.targetWeightKg,
      targetDate: profile.targetDate ?? null,
      maintenanceKcal: adaptive.kcal,
      maintenanceSource: source,
      bmr,
      screening: {
        ...(profile.screening ?? {}),
        medicalSupervision: !!profile.screening?.medicalSupervision || (profile.conditions ?? []).some((c) => SUPERVISED_CONDITIONS.includes(c)),
      },
    });
    applyDietStyle(plan, profile.dietStyle);

    // Tell the user when the system recently corrected their activity level.
    const cal = profile.activityCalibration;
    if (cal && Date.parse(today) - Date.parse(cal.at) <= 7 * 86400000) {
      plan.notices.unshift({
        level: 'info',
        code: 'activity_calibrated',
        text_ar: `عدّلنا مستوى نشاطك تلقائياً من «${LEVEL_AR[cal.from] ?? cal.from}» إلى «${LEVEL_AR[cal.to] ?? cal.to}» بناءً على ${cal.days} أيام من قياس الحرق (متوسط ${cal.avgBurnKcal.toLocaleString('en-US')} سعرة يومياً).`,
        text_en: `We adjusted your activity level from "${LEVEL_EN[cal.from] ?? cal.from}" to "${LEVEL_EN[cal.to] ?? cal.to}" based on ${cal.days} days of measured burn (average ${cal.avgBurnKcal.toLocaleString('en-US')} kcal/day).`,
      });
    }
    if (source === 'formula' && deviceDays.length > 0) {
      plan.notices.push({
        level: 'info',
        code: 'collecting_burn',
        text_ar: `نجمع قياسات حرقك من ساعتك: ${deviceDays.length} من ${CALIBRATION_MIN_DAYS} أيام. بعدها نعتمد حرقك الحقيقي ونصحح مستوى النشاط تلقائياً.`,
        text_en: `Collecting burn data from your watch: ${deviceDays.length} of ${CALIBRATION_MIN_DAYS} days. After that we use your real burn and correct your activity level automatically.`,
      });
    }

    const start = profile.startWeightKg;
    const target = profile.targetWeightKg;
    let progressPct: number | null = null;
    if (start && target && currentWeight && start !== target) {
      progressPct = Math.max(0, Math.min(100, Math.round(((start - currentWeight) / (start - target)) * 100)));
    }
    return {
      ...plan,
      currentWeightKg: currentWeight ? Math.round(currentWeight * 10) / 10 : null,
      startWeightKg: start,
      targetWeightKg: target,
      progressPct,
      changeSinceStartKg: start && currentWeight ? Math.round((currentWeight - start) * 10) / 10 : null,
      adaptiveObservedKcal: adaptive.observed,
      deviceCalibration: deviceCalibration(adaptive.observed, avgDevice, deviceDays.length),
      targetDate: profile.targetDate ?? null,
      burnData: { days: deviceDays.length, needed: CALIBRATION_MIN_DAYS, window: CALIBRATION_WINDOW_DAYS, avgKcal: avgDevice ? Math.round(avgDevice) : null },
      activityLevel: profile.activityLevel,
      activityCalibration: profile.activityCalibration ?? null,
      bmr,
      ageYears: ageOf(profile),
      dietStyle: profile.dietStyle ?? 'normal',
    };
  }

  /** Daily intake vs target for the last N days (for the progress chart). */
  async history(userId: string, days = 7) {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    const n = Math.min(Math.max(days, 1), 60);
    const from = addDays(today, -(n - 1));
    const [meals, energy, plan] = await Promise.all([
      this.repo.listMealsRange(userId, from, today),
      this.repo.listEnergyRange(userId, from, today),
      this.plan(userId),
    ]);
    const out = [];
    for (let i = 0; i < n; i++) {
      const date = addDays(from, i);
      const dayMeals = meals.filter((m) => m.date === date && m.status === 'confirmed');
      const burn = pickEnergy(energy.filter((e) => e.date === date), profile.preferredEnergySource);
      out.push({
        date,
        intakeKcal: Math.round(dayMeals.reduce((a, m) => a + m.final.totals.calories, 0)),
        proteinG: Math.round(dayMeals.reduce((a, m) => a + m.final.totals.protein_g, 0)),
        meals: dayMeals.length,
        burnKcal: burn?.totalKcal ?? null,
        targetKcal: plan.targetKcal + burnBonus({ burnKcal: burn?.totalKcal, expectedKcal: plan.maintenanceKcal || estimatedTdee(profile), partialDay: date === today, minuteOfDay: localMinuteOfDay(new Date(), profile.timezone), deviceFactor: plan.deviceCalibration?.factor }).bonusKcal,
      });
    }
    const logged = out.filter((d) => d.meals > 0);
    return {
      days: out,
      avgIntakeKcal: logged.length ? Math.round(logged.reduce((a, d) => a + d.intakeKcal, 0) / logged.length) : null,
      daysOnTarget: logged.filter((d) => Math.abs(d.intakeKcal - d.targetKcal) <= d.targetKcal * 0.1).length,
      loggedDays: logged.length,
    };
  }
}
