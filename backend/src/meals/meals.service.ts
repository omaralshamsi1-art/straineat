import { kindOf, MEAL_KINDS } from '../schedule/schedule';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NutritionAgentService } from '../agent/nutrition-agent.service';
import { localDate } from '../common/dates';
import { normalizeEstimate, normalizeKey, scaleEstimate } from '../common/nutrition-math';
import { EMPTY_NUTRIENTS, KnownMeal, Meal, MealItem, NutritionEstimate } from '../common/types';
import { ProfileService } from '../profile/profile.service';
import { PlanService } from '../plan/plan.service';
import { MealScore, scoreMeal } from '../coach/coach-math';
import { sumNutrients } from '../common/nutrition-math';
import { REPOSITORY, Repository } from '../storage/repository';

export interface AnalyzeHints {
  mealName?: string;
  restaurant?: string;
  portion?: string;
  note?: string;
  eatenAt?: string;
}

export interface MealPatch {
  meal_name?: string;
  meal_name_ar?: string;
  restaurant?: string | null;
  items?: MealItem[];
  portionFactor?: number;
  eatenAt?: string;
  kind?: 'meal' | 'snack' | 'drink';
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

@Injectable()
export class MealsService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly agent: NutritionAgentService,
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
  ) {}

  /** Meal + its score against the day's budget at the time it was eaten (excluding itself). */
  async withScore(meal: Meal): Promise<Meal & { score: MealScore; kind: string }> {
    const [plan, dayMeals] = await Promise.all([this.plans.plan(meal.userId), this.repo.listMeals(meal.userId, meal.date)]);
    const before = sumNutrients(dayMeals.filter((m) => m.id !== meal.id && m.status === 'confirmed').map((m) => m.final.totals));
    return {
      ...meal,
      kind: kindOf(meal),
      score: scoreMeal(meal.final.totals, {
        goal: plan.effectiveGoal,
        remainingBeforeKcal: plan.targetKcal - before.calories,
        dailyTargetKcal: plan.targetKcal,
      }),
    };
  }

  private async coachContext(userId: string, date: string) {
    const [plan, dayMeals, profile] = await Promise.all([this.plans.plan(userId), this.repo.listMeals(userId, date), this.profiles.get(userId)]);
    const eaten = sumNutrients(dayMeals.filter((m) => m.status === 'confirmed').map((m) => m.final.totals));
    return {
      goal: plan.effectiveGoal,
      remainingKcal: plan.targetKcal - eaten.calories,
      proteinLeftG: Math.max(0, plan.proteinG - eaten.protein_g),
      avoidRestriction: !!profile.screening?.edHistory,
      language: profile.language ?? 'en',
      dietStyle: profile.dietStyle,
      conditions: profile.conditions,
    };
  }

  async analyzePhoto(userId: string, image: Buffer, mediaType: string, hints: AnalyzeHints) {
    if (!ALLOWED_TYPES.includes(mediaType as any)) throw new BadRequestException(`Unsupported image type ${mediaType}`);
    if (image.length > 5 * 1024 * 1024) throw new BadRequestException('Image too large (max 5 MB) — resize on device');

    const profile = await this.profiles.get(userId);
    const known = await this.repo.findKnownCandidates(userId, hints.restaurant ?? null, hints.mealName ?? null);
    const at = hints.eatenAt ? new Date(hints.eatenAt) : new Date();
    const coach = await this.coachContext(userId, localDate(Number.isNaN(at.getTime()) ? new Date() : at, profile.timezone)).catch(() => null);
    const result = await this.agent.analyze({
      coach,
      image,
      mediaType: mediaType as (typeof ALLOWED_TYPES)[number],
      mealName: hints.mealName,
      restaurant: hints.restaurant,
      portion: hints.portion,
      note: hints.note,
      city: profile.city,
      country: profile.country,
      known,
    });
    const meal = await this.withScore(await this.createMeal(userId, result.estimate, hints.eatenAt, profile.timezone));
    return { meal, agent: { model: result.model, searchesUsed: result.searchesUsed, usage: result.usage } };
  }

  /** Text or voice ("أكلت شاورما دجاج وعصير برتقال") — same agent, no photo. */
  async analyzeText(userId: string, text: string, hints: AnalyzeHints) {
    const t = String(text ?? '').trim();
    if (t.length < 3) throw new BadRequestException('اكتب وصفاً للوجبة');
    if (t.length > 600) throw new BadRequestException('الوصف طويل جداً');
    const profile = await this.profiles.get(userId);
    const known = await this.repo.findKnownCandidates(userId, hints.restaurant ?? null, hints.mealName ?? t.slice(0, 60));
    const at = hints.eatenAt ? new Date(hints.eatenAt) : new Date();
    const coach = await this.coachContext(userId, localDate(Number.isNaN(at.getTime()) ? new Date() : at, profile.timezone)).catch(() => null);
    const result = await this.agent.analyze({ description: t, restaurant: hints.restaurant, city: profile.city, country: profile.country, known, coach });
    const meal = await this.withScore(await this.createMeal(userId, result.estimate, hints.eatenAt, profile.timezone));
    return { meal, agent: { model: result.model, searchesUsed: result.searchesUsed, usage: result.usage } };
  }

  /** One-tap favourites: the user's confirmed meals, most logged first. */
  async favorites(userId: string) {
    const list = await this.repo.listUserKnown(userId, 30);
    return list.map((k) => ({
      key: k.key,
      name: k.meal_name,
      name_ar: k.meal_name_ar,
      restaurant: k.restaurant,
      calories: k.totals.calories,
      protein_g: k.totals.protein_g,
      timesLogged: k.timesLogged,
      source: k.source,
    }));
  }

  /** Re-log a favourite as a confirmed meal (no AI call). */
  async logFavorite(userId: string, body: { key: string; portionFactor?: number; eatenAt?: string }) {
    const k = (await this.repo.listUserKnown(userId, 200)).find((x) => x.key === body?.key);
    if (!k) throw new NotFoundException('الوجبة غير موجودة في المفضلة');
    const profile = await this.profiles.get(userId);
    let estimate = normalizeEstimate({
      meal_name: k.meal_name,
      meal_name_ar: k.meal_name_ar,
      restaurant: k.restaurant,
      source: 'known_meal',
      confidence: 1,
      serving_description: '',
      items: k.items,
      totals: k.totals,
      sources: k.sources,
      assumptions: [],
      warnings: [],
    });
    const f = Number(body.portionFactor ?? 1);
    if (f !== 1) {
      if (!(f > 0 && f <= 5)) throw new BadRequestException('portionFactor 0–5');
      estimate = scaleEstimate(estimate, f);
    }
    const meal = await this.createMeal(userId, estimate, body.eatenAt, profile.timezone);
    return this.withScore(await this.confirm(userId, meal.id));
  }

  /** Manual entry (no photo) — e.g. user types a meal or picks from history. */
  async createManual(userId: string, body: Partial<NutritionEstimate> & { eatenAt?: string }) {
    if (!body.meal_name || !Array.isArray(body.items) || !body.items.length) {
      throw new BadRequestException('meal_name and items are required');
    }
    const profile = await this.profiles.get(userId);
    const estimate = normalizeEstimate({
      meal_name: body.meal_name,
      meal_name_ar: body.meal_name_ar ?? body.meal_name,
      restaurant: body.restaurant ?? null,
      source: body.source ?? 'estimate',
      confidence: body.confidence ?? 1,
      serving_description: body.serving_description ?? '',
      items: body.items,
      totals: { ...EMPTY_NUTRIENTS },
      sources: body.sources ?? [],
      assumptions: [],
      warnings: [],
    });
    if (body.kind === 'meal' || body.kind === 'snack' || body.kind === 'drink') estimate.kind = body.kind;
    return this.createMeal(userId, estimate, body.eatenAt, profile.timezone);
  }

  private async createMeal(userId: string, estimate: NutritionEstimate, eatenAt: string | undefined, tz: string) {
    const at = eatenAt ? new Date(eatenAt) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Invalid eatenAt');
    const now = new Date().toISOString();
    const meal: Meal = {
      id: randomUUID(),
      userId,
      eatenAt: at.toISOString(),
      date: localDate(at, tz),
      status: 'draft',
      estimate,
      final: estimate,
      edited: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.saveMeal(meal);
    return meal;
  }

  async get(userId: string, id: string) {
    const m = await this.repo.getMeal(userId, id);
    if (!m) throw new NotFoundException();
    return m;
  }

  async getScored(userId: string, id: string) {
    return this.withScore(await this.get(userId, id));
  }

  async list(userId: string, date: string) {
    return (await this.repo.listMeals(userId, date)).map((m) => ({ ...m, kind: kindOf(m) }));
  }

  async update(userId: string, id: string, patch: MealPatch) {
    const meal = await this.get(userId, id);
    let final: NutritionEstimate = { ...meal.final };
    if (patch.meal_name !== undefined) final.meal_name = patch.meal_name;
    if (patch.meal_name_ar !== undefined) final.meal_name_ar = patch.meal_name_ar;
    if (patch.restaurant !== undefined) final.restaurant = patch.restaurant;
    if (patch.items) final.items = patch.items;
    if (patch.kind !== undefined) {
      if (!MEAL_KINDS.includes(patch.kind)) throw new BadRequestException('kind must be meal, snack or drink');
      final.kind = patch.kind;
    }
    final = normalizeEstimate(final);
    if (patch.portionFactor !== undefined) {
      if (!(patch.portionFactor > 0 && patch.portionFactor <= 10)) throw new BadRequestException('portionFactor 0–10');
      final = scaleEstimate(final, patch.portionFactor);
    }
    if (patch.eatenAt) {
      const at = new Date(patch.eatenAt);
      if (Number.isNaN(at.getTime())) throw new BadRequestException('Invalid eatenAt');
      meal.eatenAt = at.toISOString();
      meal.date = localDate(at, (await this.profiles.get(userId)).timezone);
    }
    meal.final = final;
    meal.edited = true;
    meal.updatedAt = new Date().toISOString();
    await this.repo.saveMeal(meal);
    return meal;
  }

  /**
   * Confirming a meal teaches the agent: the final values become a "known meal" for this user,
   * and unedited published restaurant values are also shared globally.
   */
  async confirm(userId: string, id: string) {
    const meal = await this.get(userId, id);
    meal.status = 'confirmed';
    meal.updatedAt = new Date().toISOString();
    await this.repo.saveMeal(meal);

    const f = meal.final;
    if (f.items.length) {
      const key = normalizeKey(f.restaurant, f.meal_name);
      const existing = (await this.repo.findKnownCandidates(userId, f.restaurant, f.meal_name)).find(
        (k) => k.key === key && k.userId === userId,
      );
      const base: Omit<KnownMeal, 'userId' | 'timesLogged'> = {
        key,
        restaurant: f.restaurant,
        meal_name: f.meal_name,
        meal_name_ar: f.meal_name_ar,
        source: meal.edited ? 'known_meal' : f.source,
        items: f.items,
        totals: f.totals,
        sources: f.sources,
        updatedAt: meal.updatedAt,
      };
      await this.repo.upsertKnown({ ...base, userId, timesLogged: (existing?.timesLogged ?? 0) + 1 });
      if (!meal.edited && f.source === 'restaurant_published' && f.sources.length && f.confidence >= 0.8) {
        await this.repo.upsertKnown({ ...base, userId: null, timesLogged: 1 });
      }
    }
    return meal;
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.repo.deleteMeal(userId, id);
    return { deleted: true };
  }
}
