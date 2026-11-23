import { kindOf } from '../schedule/schedule';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { sumNutrients } from '../common/nutrition-math';
import { EnergyDay, EnergySource } from '../common/types';
import { bmrKcal, estimatedTdee, ProfileService } from '../profile/profile.service';
import { pickEnergy, PlanService } from '../plan/plan.service';
import { WorkoutsService } from '../workouts/workouts.service';
import { ramadanTips, ramadanView } from '../coach/coach-math';
import { REPOSITORY, Repository } from '../storage/repository';
import { burnBonus, localMinuteOfDay, todayCards, WellnessDay } from '../insights/insights';

export interface EnergySampleInput {
  date: string;
  source: EnergySource;
  activeKcal?: number | null;
  basalKcal?: number | null;
  totalKcal?: number | null;
}

const VALID_SOURCES = new Set<EnergySource>(['whoop', 'apple_health', 'health_connect', 'garmin', 'fitbit', 'manual', 'estimate']);

@Injectable()
export class EnergyService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
    private readonly workouts: WorkoutsService,
  ) {}

  async ingest(userId: string, samples: EnergySampleInput[]) {
    if (!Array.isArray(samples) || !samples.length) throw new BadRequestException('samples[] required');
    const saved: EnergyDay[] = [];
    let restFill: ((date: string) => number | null) | undefined;
    for (const s of samples) {
      if (!isIsoDate(s.date)) throw new BadRequestException(`Invalid date ${s.date}`);
      if (!VALID_SOURCES.has(s.source)) throw new BadRequestException(`Invalid source ${s.source}`);
      const active = num(s.activeKcal);
      let basal = num(s.basalKcal);
      // Trackers that reach Apple Health through another app (Fitbit Air via Google Health, many
      // bands) write active calories only; without an Apple Watch there is no resting energy, and
      // the day's burn would be a few hundred kcal. Fill the resting part from the BMR formula.
      if (s.source === 'apple_health' && num(s.totalKcal) == null && active != null && active > 0 && !(basal && basal > 0)) {
        restFill ??= await this.restingFill(userId);
        basal = restFill(s.date) ?? basal;
      }
      const total = num(s.totalKcal) ?? (active != null || basal != null ? (active ?? 0) + (basal ?? 0) : null);
      if (total == null) throw new BadRequestException('Provide totalKcal or active/basal kcal');
      const day: EnergyDay = {
        userId,
        date: s.date,
        source: s.source,
        activeKcal: active,
        basalKcal: basal,
        totalKcal: Math.round(total),
        updatedAt: new Date().toISOString(),
      };
      await this.repo.upsertEnergy(day);
      saved.push(day);
    }
    return { saved: saved.length };
  }

  /** BMR for a past day, or the share of it already elapsed today (null when the profile is incomplete). */
  private async restingFill(userId: string, now = new Date()): Promise<(date: string) => number | null> {
    const profile = await this.profiles.get(userId);
    const bmr = bmrKcal(profile, now);
    const today = localDate(now, profile.timezone);
    const elapsed = localMinuteOfDay(now, profile.timezone) / 1440;
    return (date) => (bmr == null || date > today ? null : Math.round(date === today ? bmr * elapsed : bmr));
  }

  async balance(userId: string, date?: string, now = new Date()) {
    const profile = await this.profiles.get(userId);
    const today = localDate(now, profile.timezone);
    const d = date ?? today;
    if (!isIsoDate(d)) throw new BadRequestException('date must be YYYY-MM-DD');

    const [meals, days, plan, activity] = await Promise.all([
      this.repo.listMeals(userId, d),
      this.repo.listEnergy(userId, d),
      this.plans.plan(userId),
      this.workouts.forDay(userId, d),
    ]);
    const confirmed = meals.filter((m) => m.status === 'confirmed');
    const intake = sumNutrients(confirmed.map((m) => m.final.totals));
    const pending = sumNutrients(meals.filter((m) => m.status === 'draft').map((m) => m.final.totals));
    const chosen = pickEnergy(days, profile.preferredEnergySource);
    const isToday = d === today;

    // The daily target comes from the plan; a day that burns clearly more than the plan expects
    // adds back half of the extra (device estimates are rough), never less than the plan.
    const expectedBurn = Math.round(plan.maintenanceKcal || estimatedTdee(profile) || 0) || null;
    const minuteOfDay = localMinuteOfDay(now, profile.timezone);
    const deviceFactor = plan.deviceCalibration?.factor ?? null;
    const bonus = burnBonus({ burnKcal: chosen?.totalKcal, expectedKcal: expectedBurn, partialDay: isToday, minuteOfDay, deviceFactor });
    const target = plan.targetKcal + bonus.bonusKcal;
    const macroTargets = { protein_g: plan.proteinG, carbs_g: plan.carbsG, fat_g: plan.fatG, fiber_g: plan.fiberG };
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));

    return {
      date: d,
      intake,
      pendingDrafts: pending,
      burn: chosen
        ? { source: chosen.source, totalKcal: chosen.totalKcal, activeKcal: chosen.activeKcal, basalKcal: chosen.basalKcal }
        : null,
      burnIsPartialDay: isToday && !!chosen,
      estimatedTdee: estimatedTdee(profile),
      /** the plan's best estimate of a full day's burn (adaptive / device / formula) */
      expectedBurnKcal: expectedBurn,
      /** today's burn projected to a full day (burn so far + expected rate for the hours left) */
      projectedBurnKcal: bonus.projectedKcal,
      /** plan target before any extra-burn allowance */
      baseTargetKcal: plan.targetKcal,
      /** kcal added today because the device shows a bigger day than expected */
      burnBonusKcal: bonus.bonusKcal,
      /** why: share of the extra returned and this person's device accuracy (null until calibrated) */
      burnBonusInfo: { share: bonus.share, deviceAccuracyPct: plan.deviceCalibration?.accuracyPct ?? null, deviceFactor },
      goal: plan.effectiveGoal,
      goalDeltaKcal: plan.dailyDeltaKcal,
      targetIntakeKcal: target,
      remainingKcal: target - intake.calories,
      netKcal: chosen ? intake.calories - chosen.totalKcal : null,
      macroTargets,
      macroSplitPct: macroSplit(intake),
      ramadan: isToday ? ramadanView(profile.ramadan, now, profile.timezone, target) : null,
      tips: (() => {
        const ram = isToday ? ramadanView(profile.ramadan, now, profile.timezone, target) : null;
        if (ram?.active) return [...ramadanTips(ram, intake.calories), ...dailyTips({ intake, target, macroTargets, goal: plan.effectiveGoal, isToday, hour, mealsCount: confirmed.length }).filter((t) => t.kind === 'protein' || t.kind === 'over')].slice(0, 2);
        return dailyTips({ intake, target, macroTargets, goal: plan.effectiveGoal, isToday, hour, mealsCount: confirmed.length });
      })(),
      onboarded: profile.onboarded,
      activity,
      /** morning plan (from WHOOP recovery/sleep) and after-workout note, today only */
      cards: isToday
        ? todayCards({
            date: d,
            now,
            tz: profile.timezone,
            wellness: ((await this.repo.getCache(userId, `whoop-day:${d}`))?.payload as WellnessDay | undefined) ?? null,
            workouts: activity.workouts.map((w: any) => ({ id: w.id, sportAr: w.sportAr, sportEn: w.sportEn, end: w.end, durationMin: w.durationMin, kcal: w.kcal, strain: w.strain })),
            weightKg: plan.currentWeightKg ?? profile.weightKg ?? null,
            proteinTargetG: plan.proteinG,
            bonusKcal: bonus.bonusKcal,
            ramadan: !!ramadanView(profile.ramadan, now, profile.timezone, target)?.active,
            fasting: !!ramadanView(profile.ramadan, now, profile.timezone, target)?.fasting,
          })
        : [],
      meals: meals.map((m) => ({
        id: m.id,
        eatenAt: m.eatenAt,
        status: m.status,
        name: m.final.meal_name,
        name_ar: m.final.meal_name_ar,
        restaurant: m.final.restaurant,
        source: m.final.source,
        calories: m.final.totals.calories,
        protein_g: m.final.totals.protein_g,
        kind: kindOf(m),
      })),
      availableSources: days.map((x) => x.source),
    };
  }
}

/** Short, rule-based nudges (the AI coach arrives in phase 2b). Max two, kind tone, no shaming. */
export function dailyTips(i: {
  intake: { calories: number; protein_g: number; fiber_g: number };
  target: number;
  macroTargets: { protein_g: number; fiber_g: number };
  goal: string;
  isToday: boolean;
  hour: number;
  mealsCount: number;
}): { kind: string; text_ar: string; text_en: string }[] {
  const tips: { kind: string; text_ar: string; text_en: string }[] = [];
  if (!i.isToday) return tips;
  const proteinLeft = Math.round(i.macroTargets.protein_g - i.intake.protein_g);
  const kcalLeft = Math.round(i.target - i.intake.calories);
  if (i.mealsCount === 0 && i.hour >= 11) {
    tips.push({ kind: 'log', text_ar: 'لم تسجّل أي وجبة اليوم بعد — صوّر وجبتك القادمة ليبقى الحساب دقيقاً.', text_en: "You haven't logged a meal today — snap your next one to keep the count accurate." });
  }
  if (proteinLeft >= 25 && i.hour >= 14) {
    const extra = i.goal === 'lose' ? 'البروتين يحافظ على عضلاتك ويقلل الجوع' : 'البروتين أساس بناء العضل';
    const extraEn = i.goal === 'lose' ? 'protein protects your muscle and curbs hunger' : 'protein is the building block of muscle';
    tips.push({
      kind: 'protein',
      text_ar: `يتبقى ${proteinLeft} غ بروتين لهدف اليوم — ${extra}. خيارات سهلة: لبن يوناني، بيض، دجاج مشوي، تونة.`,
      text_en: `${proteinLeft} g protein left for today — ${extraEn}. Easy options: Greek yoghurt, eggs, grilled chicken, tuna.`,
    });
  }
  if (i.goal === 'gain' && kcalLeft > 600 && i.hour >= 17) {
    tips.push({ kind: 'gain', text_ar: `يتبقى ${kcalLeft} سعرة لهدف الزيادة — أضف وجبة خفيفة غنية: مكسرات، تمر مع لبن، أو ساندويتش زبدة فول سوداني.`, text_en: `${kcalLeft} kcal left for your gain goal — add a rich snack: nuts, dates with yoghurt, or a peanut-butter sandwich.` });
  }
  if (kcalLeft < -150) {
    tips.push({ kind: 'over', text_ar: 'تجاوزت هدف اليوم قليلاً — لا مشكلة، يوم واحد لا يغيّر الاتجاه. ركّز على الماء والمشي، ونكمل غداً.', text_en: "A little over today's goal — no problem, one day doesn't change the trend. Focus on water and a walk; we carry on tomorrow." });
  } else if (i.goal === 'lose' && kcalLeft > 0 && kcalLeft < 350 && i.hour < 17) {
    tips.push({ kind: 'budget', text_ar: `تبقى ${kcalLeft} سعرة — اختر عشاءً خفيفاً غنياً بالخضار والبروتين.`, text_en: `${kcalLeft} kcal left — pick a light dinner rich in vegetables and protein.` });
  }
  if (i.intake.calories > 1000 && i.intake.fiber_g < i.macroTargets.fiber_g * 0.4 && i.hour >= 15) {
    tips.push({ kind: 'fiber', text_ar: 'الألياف قليلة اليوم — أضف خضاراً أو فاكهة أو حمّص للشبع وصحة الهضم.', text_en: 'Fibre is low today — add vegetables, fruit or hummus for fullness and digestion.' });
  }
  return tips.slice(0, 2);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) || n < 0 ? null : n;
}

function macroSplit(n: { protein_g: number; carbs_g: number; fat_g: number }) {
  const p = n.protein_g * 4;
  const c = n.carbs_g * 4;
  const f = n.fat_g * 9;
  const t = p + c + f;
  if (!t) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: Math.round((p / t) * 100), carbs: Math.round((c / t) * 100), fat: Math.round((f / t) * 100) };
}
