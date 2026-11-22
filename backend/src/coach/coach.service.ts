import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { NutritionAgentService } from '../agent/nutrition-agent.service';
import { localDate } from '../common/dates';
import { EnergyService } from '../energy/energy.service';
import { addDays, pickEnergy, PlanService } from '../plan/plan.service';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { dietLine } from '../agent/prompts';
import { ramadanView } from './coach-math';

const SAFETY = `Safety rules (always):
- Never suggest eating below the user's daily calorie target or skipping meals to "make up" for a big day.
- No crash diets, detoxes, laxatives, fasting beyond the user's own religious fasting, or supplements.
- If avoidRestriction is true, never talk about cutting calories; focus on balanced, nourishing choices.
- If the user has a medical-supervision flag, add a short reminder to follow their clinician's advice.
- Kind, practical, culturally relevant to the UAE/Gulf (local dishes, restaurants, cafés).`;

/** Output-language rule. JSON keys ending in "_ar" are historical names: their text follows this rule. */
export const langRule = (lang: string) =>
  lang === 'ar'
    ? 'Write every text field in Arabic (Gulf-friendly Modern Standard Arabic).'
    : 'Write every text field in clear, friendly English (field names ending in "_ar" still get English text). Local dish names may stay in their usual form, e.g. "chicken shawarma", "machboos".';

const NUTR = {
  kcal: { type: 'number' },
  protein_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fat_g: { type: 'number' },
} as const;
const OUT_OPTION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'exact menu item name (plus the size)' },
    restaurant: { type: 'string', description: 'chain name only' },
    order_tip: { type: 'string', description: 'how to order it to fit, e.g. grilled, no mayo, half rice; empty if none' },
    why: { type: 'string' },
    ...NUTR,
  },
  required: ['title', 'restaurant', 'order_tip', 'why', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
} as const;
const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intro_ar: { type: 'string' },
    home: {
      type: 'array',
      description: 'exactly 2 home recipes, one serving each',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          prep_min: { type: 'number' },
          ingredients: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, properties: { item: { type: 'string' }, amount: { type: 'string', description: 'grams/ml/spoons/pieces' } }, required: ['item', 'amount'] },
          },
          steps: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
          ...NUTR,
        },
        required: ['title', 'prep_min', 'ingredients', 'steps', 'why', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
    healthy: { type: 'array', description: 'exactly 2 options from healthy restaurants / meal-prep brands', items: OUT_OPTION },
    fast: { type: 'array', description: 'exactly 2 options from fast-food chains', items: OUT_OPTION },
  },
  required: ['intro_ar', 'home', 'healthy', 'fast'],
} as const;

const WEEKLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline_ar: { type: 'string' },
    wins_ar: { type: 'array', items: { type: 'string' } },
    improve_ar: { type: 'array', items: { type: 'string' } },
    next_week_goal_ar: { type: 'string' },
  },
  required: ['headline_ar', 'wins_ar', 'improve_ar', 'next_week_goal_ar'],
} as const;

const minutes = (n: number) => n * 60_000;

@Injectable()
export class CoachService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly agent: NutritionAgentService,
    private readonly plans: PlanService,
    private readonly energy: EnergyService,
    private readonly profiles: ProfileService,
  ) {}

  private async cached<T>(userId: string, key: string, ttlMs: number, make: () => Promise<T>): Promise<T & { cached: boolean }> {
    const hit = await this.repo.getCache(userId, key);
    if (hit && Date.now() - Date.parse(hit.createdAt) < ttlMs) return { ...(hit.payload as T), cached: true };
    const fresh = await make();
    await this.repo.setCache({ userId, key, payload: fresh, createdAt: new Date().toISOString() });
    return { ...fresh, cached: false };
  }

  /** "What should I eat now?" — options that fit what is left today. */
  async suggest(userId: string, opts: { force?: boolean } = {}) {
    const profile = await this.profiles.get(userId);
    const b = await this.energy.balance(userId);
    const remaining = Math.round(b.remainingKcal);
    const proteinLeft = Math.max(0, Math.round(b.macroTargets.protein_g - b.intake.protein_g));
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const ram = ramadanView(profile.ramadan, now, profile.timezone, b.targetIntakeKcal);

    // Preferences: the user's confirmed meals in the last 21 days (names + restaurants only).
    const today = localDate(now, profile.timezone);
    const recent = (await this.repo.listMealsRange(userId, addDays(today, -21), today)).filter((m) => m.status === 'confirmed');
    const favourites = [...new Map(recent.map((m) => [`${m.final.restaurant ?? ''}|${m.final.meal_name}`, m])).values()]
      .slice(-12)
      .map((m) => `${m.final.meal_name} / ${m.final.meal_name_ar}${m.final.restaurant ? ` (${m.final.restaurant})` : ''} — ${Math.round(m.final.totals.calories)} kcal, ${Math.round(m.final.totals.protein_g)} g protein`);

    const slot = ram.active
      ? ram.fasting ? 'iftar (the user is fasting now)' : hour < 4 || hour >= 22 ? 'suhoor' : 'evening meal after iftar'
      : hour < 5 || hour >= 22 ? 'light late snack' : hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 19 ? 'afternoon snack or early dinner' : 'dinner';
    const lang = profile.language ?? 'en';
    const key = `suggest6:${lang}:${profile.dietStyle ?? 'normal'}:${today}:${slot}:${Math.round(remaining / 75)}:${Math.round(proteinLeft / 10)}`;
    // What was already shown today, so "refresh" brings different restaurants and recipes.
    const seenKey = `suggest6-seen:${today}`;
    const seen: string[] = ((await this.repo.getCache(userId, seenKey))?.payload as any)?.items ?? [];
    const place = [profile.area, profile.city].filter(Boolean).join(', ') || 'the UAE';
    const wh = ((await this.repo.getCache(userId, `whoop-day:${today}`))?.payload ?? null) as any;
    const whoopLine = wh && (wh.recovery != null || wh.sleepMin != null)
      ? `WHOOP today: ${wh.recovery != null ? `recovery ${wh.recovery}% (${wh.recovery < 34 ? 'LOW' : wh.recovery < 67 ? 'moderate' : 'high'})` : ''}${wh.sleepMin != null ? `, slept ${Math.floor(wh.sleepMin / 60)}h${wh.sleepMin % 60}m${wh.sleepNeededMin ? ` of ${Math.floor(wh.sleepNeededMin / 60)}h${wh.sleepNeededMin % 60}m needed` : ''}` : ''}${wh.strain != null ? `, day strain ${wh.strain}/21` : ''}.`
      : '';
    const result = await this.cached(userId, key, opts.force ? 0 : minutes(45), async () => {
      const system = `You are StrainEat's nutrition coach. Give the user 6 options for their next meal, in three groups:
- home: 2 home recipes (one serving each) with exact ingredient amounts (g, ml, spoons, pieces), 3–6 short steps and prep minutes. Everyday ingredients sold in UAE supermarkets; vary cuisines (Gulf, Levantine, Indian, Asian, Western).
- healthy: 2 dishes from healthy-focused restaurants or meal-prep brands that have branches in the user's emirate.
- fast: 2 items from mainstream fast-food chains in the UAE — pick the menu item (and size) that best fits the user's numbers, plus how to order it lighter.
Restaurant rules: only well-known chains/brands that really operate in the user's emirate; never invent restaurant names or menu items; prefer chains with published nutrition and use those values; vary brands — don't always pick the most famous ones; prefer restaurants the user already eats at when they fit.
${SAFETY}
${langRule(lang)}
Every option needs realistic kcal, protein, carbs and fat for what is described.`;
      const user = [
        `Meal slot: ${slot}. Local time hour: ${hour}. Location: ${place}.`,
        `Goal: ${b.goal}. Calories left today: ${remaining}. Protein left today: ${proteinLeft} g. Fibre so far: ${Math.round(b.intake.fiber_g)} of ${b.macroTargets.fiber_g} g.`,
        ram.active && ram.split ? `Ramadan mode: suhoor ≈${ram.split.suhoor}, iftar ≈${ram.split.iftar}, evening ≈${ram.split.evening} kcal.` : '',
        `avoidRestriction: ${!!profile.screening?.edHistory}. medicalSupervision: ${!!profile.screening?.medicalSupervision}.`,
        dietLine(profile.dietStyle, profile.conditions),
        whoopLine,
        whoopLine ? 'If recovery is LOW or sleep was short (under ~6h): prefer easy, protein-rich, hydrating options with complex carbs, mention cravings gently in "why", and never push extra restriction. High strain: make sure options refuel (carbs + protein).' : '',
        profile.mealsPerDay ? `The user usually eats ${profile.mealsPerDay} meal(s) a day — size the options for that.` : '',
        favourites.length ? `Recent meals the user enjoyed:\n- ${favourites.join('\n- ')}` : 'No meal history yet.',
        seen.length ? `Already suggested today — give DIFFERENT recipes and different restaurants this time:\n- ${seen.slice(-24).join('\n- ')}` : '',
        b.goal === 'gain'
          ? 'For weight gain: options should be calorie- and protein-dense enough to close the gap.'
          : remaining <= 0
            ? 'The user has reached today’s target: every option must be light, high-protein, high-fibre and under ~250 kcal. No guilt.'
            : 'Keep every option within the calories left (or slightly under) and prioritise protein.',
      ].filter(Boolean).join('\n');
      const out = await this.agent.completeJson<any>(system, user, SUGGEST_SCHEMA, 3000);
      const cap = b.goal === 'gain' ? Infinity : Math.max(250, remaining + 100);
      const num = (o: any) => ({ kcal: Math.round(Number(o.kcal) || 0), protein_g: Math.round(Number(o.protein_g) || 0), carbs_g: Math.round(Number(o.carbs_g) || 0), fat_g: Math.round(Number(o.fat_g) || 0) });
      const fits = (o: any) => o.kcal > 0 && o.kcal <= cap;
      const home = (out.home ?? [])
        .map((o: any) => ({ title: String(o.title ?? ''), prep_min: Math.round(Number(o.prep_min) || 0), ingredients: (o.ingredients ?? []).slice(0, 15), steps: (o.steps ?? []).slice(0, 8), why: String(o.why ?? ''), ...num(o) }))
        .filter(fits).slice(0, 2);
      const eat = (list: any[]) =>
        (list ?? []).map((o: any) => ({ title: String(o.title ?? ''), restaurant: String(o.restaurant ?? ''), order_tip: String(o.order_tip ?? ''), why: String(o.why ?? ''), ...num(o) })).filter(fits).slice(0, 2);
      const healthy = eat(out.healthy);
      const fast = eat(out.fast);
      // legacy flat list for older app builds
      const options = [
        ...home.map((o: any) => ({ title_ar: o.title, where_ar: lang === 'ar' ? 'البيت' : 'Home', kcal: o.kcal, protein_g: o.protein_g, why_ar: o.why })),
        ...[...healthy, ...fast].map((o: any) => ({ title_ar: o.title, where_ar: o.restaurant, kcal: o.kcal, protein_g: o.protein_g, why_ar: o.order_tip || o.why })),
      ];
      return { slot, remainingKcal: remaining, proteinLeftG: proteinLeft, intro_ar: out.intro_ar ?? '', home, healthy, fast, options };
    });
    const mapsQuery = [profile.area, profile.city ?? (profile.country === 'AE' ? 'UAE' : profile.country)].filter(Boolean).join(' ');
    (result as any).mapsArea = mapsQuery;
    if (!result.cached) {
      const shown = [...result.home.map((o: any) => `home: ${o.title}`), ...[...result.healthy, ...result.fast].map((o: any) => `${o.restaurant}: ${o.title}`)];
      await this.repo.setCache({ userId, key: seenKey, payload: { items: [...seen, ...shown].slice(-40) }, createdAt: new Date().toISOString() });
    }
    return result;
  }

  /** Weekly report: numbers computed here; the AI only writes the narrative. */
  async weekly(userId: string, opts: { force?: boolean } = {}) {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    const end = addDays(today, -1);
    const start = addDays(end, -6);
    const [plan, meals, energy, weights, workouts] = await Promise.all([
      this.plans.plan(userId),
      this.repo.listMealsRange(userId, start, end),
      this.repo.listEnergyRange(userId, start, end),
      this.plans.weights(userId, 30),
      this.repo.listWorkouts(userId, start, end),
    ]);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const ms = meals.filter((m) => m.date === d && m.status === 'confirmed');
      const burn = pickEnergy(energy.filter((e) => e.date === d), profile.preferredEnergySource);
      days.push({
        date: d,
        logged: ms.length > 0,
        kcal: Math.round(ms.reduce((a, m) => a + m.final.totals.calories, 0)),
        protein: Math.round(ms.reduce((a, m) => a + m.final.totals.protein_g, 0)),
        fiber: Math.round(ms.reduce((a, m) => a + m.final.totals.fiber_g, 0)),
        burn: burn?.totalKcal ?? null,
      });
    }
    const logged = days.filter((d) => d.logged);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
    const onTarget = logged.filter((d) =>
      plan.effectiveGoal === 'gain' ? d.kcal >= plan.targetKcal * 0.95 && d.kcal <= plan.targetKcal * 1.15 : d.kcal <= plan.targetKcal,
    ).length;
    const wIn = weights.entries.filter((w) => w.date >= addDays(start, -1) && w.date <= end);
    const weightChange = wIn.length >= 2 ? Math.round((wIn[wIn.length - 1].trend - wIn[0].trend) * 10) / 10 : null;
    const stats = {
      from: start,
      to: end,
      loggedDays: logged.length,
      daysOnTarget: onTarget,
      avgKcal: avg(logged.map((d) => d.kcal)),
      targetKcal: plan.targetKcal,
      avgProtein: avg(logged.map((d) => d.protein)),
      proteinTarget: plan.proteinG,
      avgFiber: avg(logged.map((d) => d.fiber)),
      fiberTarget: plan.fiberG,
      avgBurn: avg(days.filter((d) => d.burn != null).map((d) => d.burn as number)),
      avgDeficit: (() => {
        const both = logged.filter((d) => d.burn != null);
        return both.length ? Math.round(both.reduce((a, d) => a + ((d.burn as number) - d.kcal), 0) / both.length) : null;
      })(),
      weightChangeKg: weightChange,
      workouts: workouts.length,
      workoutMinutes: Math.round(workouts.reduce((a, w) => a + w.durationMin, 0)),
      goal: plan.effectiveGoal,
      days,
    };
    const hash = createHash('sha1').update(JSON.stringify(stats)).digest('hex').slice(0, 10);
    const lang = profile.language ?? 'en';
    return this.cached(userId, `weekly:${lang}:${start}:${hash}`, opts.force ? 0 : minutes(60 * 12), async () => {
      if (stats.loggedDays === 0) {
        return {
          stats,
          narrative: lang === 'ar'
            ? {
                headline_ar: 'لم تُسجَّل وجبات هذا الأسبوع بعد',
                wins_ar: [],
                improve_ar: ['سجّل وجبة واحدة يومياً على الأقل ليتمكّن المدرب من تقييم أسبوعك.'],
                next_week_goal_ar: 'هدف الأسبوع القادم: تسجيل وجباتك 5 أيام من 7.',
              }
            : {
                headline_ar: 'No meals logged this week yet',
                wins_ar: [],
                improve_ar: ['Log at least one meal a day so the coach can review your week.'],
                next_week_goal_ar: "Next week's goal: log your meals 5 days out of 7.",
              },
        };
      }
      const system = `You are StrainEat's coach writing a short weekly review.\n${SAFETY}\n${langRule(lang)}\nUse ONLY the numbers given — do not invent data. 2–3 wins, 2–3 specific improvements, and one small, measurable goal for next week. Celebrate consistency. Keep each bullet under 25 words.`;
      const user = `avoidRestriction: ${!!profile.screening?.edHistory}\nWeek stats (JSON):\n${JSON.stringify({ ...stats, days: undefined, perDay: stats.days })}`;
      const narrative = await this.agent.completeJson<any>(system, user, WEEKLY_SCHEMA, 1200);
      return { stats, narrative };
    });
  }
}
