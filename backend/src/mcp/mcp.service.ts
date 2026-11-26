import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { REPOSITORY, Repository } from '../storage/repository';
import { MealsService } from '../meals/meals.service';
import { EnergyService } from '../energy/energy.service';
import { PlanService } from '../plan/plan.service';
import { WaterService } from '../water/water.service';
import { StepsService } from '../steps/steps.service';
import { normalizeKey } from '../common/nutrition-math';
import { MealItem } from '../common/types';
import { OAuthService } from './oauth.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MEAL_CARD_URI = 'ui://straineat/meal-card.html';
/** MCP Apps (SEP-1865) resource MIME type. */
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
let cardHtml: string | null = null;
/** The meal review card (MCP Apps UI). The ext-apps client bundle is inlined: the sandboxed iframe can't load scripts from elsewhere. */
export function mealCardHtml(): string {
  if (cardHtml) return cardHtml;
  const bundle = readFileSync(require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8');
  const at = bundle.lastIndexOf('export{');
  const names = bundle.slice(at + 7, bundle.indexOf('}', at)).split(',').map((p) => p.trim().split(/\s+as\s+/));
  const glue = `globalThis.McpApps={${names.map(([local, exported]) => `${exported ?? local}:${local}`).join(',')}};`;
  const lib = bundle.slice(0, at) + glue + bundle.slice(bundle.indexOf('}', at) + 1).replace(/^;/, '');
  const tpl = readFileSync(join(__dirname, '..', '..', 'public', 'mcp', 'meal-card.html'), 'utf8');
  cardHtml = tpl.replace('/*__MCP_APPS__*/', () => lib.replace(/<\/script/gi, '<\\/script'));
  return cardHtml;
}

/** Scale one item's amount and nutrients by `f`. */
export function scaleItem(it: MealItem, f: number): MealItem {
  const r1 = (v: unknown) => Math.round(Number(v ?? 0) * f * 10) / 10;
  return {
    ...it,
    grams: it.grams ? Math.round(it.grams * f) : it.grams,
    quantity: it.grams ? it.quantity : Math.round((it.quantity ?? 1) * f * 100) / 100,
    calories: r1(it.calories), protein_g: r1(it.protein_g), carbs_g: r1(it.carbs_g), fat_g: r1(it.fat_g),
    fiber_g: r1(it.fiber_g), sugar_g: r1(it.sugar_g), sodium_mg: Math.round(Number(it.sodium_mg ?? 0) * f),
  };
}

const LOOKUP_USER = '__lookup__';
export const MCP_RATE_LIMIT = 60; // requests per key per minute
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);

const INSTRUCTIONS = `StrainEat is the user's meal-photo nutrition tracker. Use these tools to log what they eat and drink and to answer "how much is left today".
- When the user shares a meal photo or describes a meal, identify each item, estimate grams, and estimate per-item calories, protein, carbs, fat (and fiber/sugar/sodium when you can). Count cooking oil, butter and sauces. Then call log_meal once for the whole meal.
- If the meal is from a named restaurant, pass restaurant and the exact menu item name: StrainEat prefers the restaurant's published values or the user's own saved version of that meal over your estimate.
- Before logging, if a portion is genuinely unclear, ask one short question; otherwise log and tell the user what you assumed.
- Use today_summary for remaining calories/protein and to suggest what to eat next. Reply in the user's language (Arabic or English).
- This is nutrition tracking, not medical advice.`;

@Injectable()
export class McpService {
  private readonly log = new Logger(McpService.name);
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly meals: MealsService,
    private readonly energy: EnergyService,
    private readonly plans: PlanService,
    private readonly water: WaterService,
    private readonly steps: StepsService,
    @Optional() private readonly oauth?: OAuthService,
  ) {}

  /** Personal connector link token (trial: the secret lives in the URL; OAuth comes later). */
  async token(userId: string, rotate = false) {
    const mine = await this.repo.getCache(userId, 'mcp-token');
    const old = (mine?.payload as any)?.token as string | undefined;
    if (old && !rotate) return { token: old };
    if (old) await this.repo.setCache({ userId: LOOKUP_USER, key: `mcp:${hash(old)}`, payload: { revoked: true }, createdAt: new Date().toISOString() });
    const token = randomBytes(24).toString('base64url');
    const now = new Date().toISOString();
    await this.repo.setCache({ userId: LOOKUP_USER, key: `mcp:${hash(token)}`, payload: { userId }, createdAt: now });
    await this.repo.setCache({ userId, key: 'mcp-token', payload: { token }, createdAt: now });
    return { token };
  }

  async userFor(token: string | undefined): Promise<string> {
    if (!token || token.length < 20) throw new UnauthorizedException('Missing connector token');
    if (token.startsWith('sea_')) {
      const viaOAuth = await this.oauth?.userForAccessToken(token);
      if (!viaOAuth) throw new UnauthorizedException('Invalid or expired access token');
      return viaOAuth;
    }
    const hit = await this.repo.getCache(LOOKUP_USER, `mcp:${hash(token)}`);
    const userId = (hit?.payload as any)?.userId as string | undefined;
    if (!userId) throw new UnauthorizedException('Invalid connector token');
    return userId;
  }

  /** Key from `Authorization: Bearer <key>` / `X-Api-Key` (preferred: never in URLs or proxy logs), else the legacy link path. */
  static keyFrom(req: Pick<Request, 'headers'>, pathToken?: string): string | undefined {
    const auth = String(req.headers?.authorization ?? '');
    const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
    const apiKey = req.headers?.['x-api-key'];
    return bearer || (typeof apiKey === 'string' && apiKey.trim()) || pathToken || undefined;
  }

  private readonly hits = new Map<string, number[]>();
  /** Per-key sliding window (in-memory; one instance). */
  allow(key: string, limit = MCP_RATE_LIMIT, windowMs = 60_000, now = Date.now()): boolean {
    const k = hash(key);
    const recent = (this.hits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) { this.hits.set(k, recent); return false; }
    recent.push(now);
    this.hits.set(k, recent);
    if (this.hits.size > 5000) for (const [kk, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(kk);
    return true;
  }

  async handle(req: Request, res: Response, pathToken?: string) {
    const rpcError = (status: number, code: number, message: string) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
    const key = McpService.keyFrom(req, pathToken);
    if (key && !this.allow(key)) { res.set('Retry-After', '60'); rpcError(429, -32029, 'Too many requests — try again in a minute'); return; }
    let userId: string;
    try { userId = await this.userFor(key); } catch (e: any) {
      // Point MCP clients at the OAuth flow (RFC 9728) — only on the header endpoint, legacy links stay key-only.
      if (!pathToken && this.oauth) res.set('WWW-Authenticate', `Bearer resource_metadata="${this.oauth.base(req)}/.well-known/oauth-protected-resource/mcp", scope="straineat"`);
      rpcError(401, -32001, e.message);
      return;
    }
    const server = this.build(userId, this.oauth?.base(req) ?? '');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => undefined); server.close().catch(() => undefined); });
    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  }

  async today(userId: string) {
    const b: any = await this.energy.balance(userId);
    const [w, s, list] = await Promise.all([
      this.water.day(userId).catch(() => null),
      this.steps.day(userId).catch(() => null),
      this.meals.list(userId, b.date).catch(() => [] as any[]),
    ]);
    return {
      date: b.date,
      targetKcal: b.targetIntakeKcal,
      eatenKcal: b.intake?.calories,
      leftKcal: b.remainingKcal,
      protein: { eatenG: b.intake?.protein_g, targetG: b.macroTargets?.protein_g },
      carbs: { eatenG: b.intake?.carbs_g, targetG: b.macroTargets?.carbs_g },
      fat: { eatenG: b.intake?.fat_g, targetG: b.macroTargets?.fat_g },
      fiber: { eatenG: b.intake?.fiber_g, targetG: b.macroTargets?.fiber_g },
      burnKcal: b.burn?.totalKcal ?? null,
      waterMl: w ? { drank: w.intakeMl, target: w.targetMl } : null,
      steps: s ? { steps: s.steps, goal: s.goal } : null,
      fasting: b.ramadan?.active ? { suhoor: b.ramadan.suhoorTime, iftar: b.ramadan.iftarTime } : null,
      meals: (list as any[]).filter((m) => m.status === 'confirmed').map((m) => ({ name: m.final.meal_name, kcal: Math.round(m.final.totals.calories), at: m.eatenAt })),
    };
  }

  /** What the meal card renders: the saved meal plus today's balance. */
  async card(userId: string, meal: any, base: string) {
    const day = await this.today(userId).catch(() => null);
    const f = meal.final;
    return {
      meal: {
        id: meal.id, status: meal.status, name: f.meal_name, name_ar: f.meal_name_ar, restaurant: f.restaurant ?? null, source: f.source,
        items: (f.items ?? []).map((i: MealItem) => ({ name: i.name, name_ar: i.name_ar, quantity: i.quantity, unit: i.unit, grams: i.grams, calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g })),
        totals: { calories: f.totals.calories, protein_g: f.totals.protein_g, carbs_g: f.totals.carbs_g, fat_g: f.totals.fat_g },
      },
      today: day && { leftKcal: day.leftKcal, targetKcal: day.targetKcal, eatenKcal: day.eatenKcal, protein: day.protein },
      appUrl: `${base}/app/`,
    };
  }

  private build(userId: string, base = '') {
    const server = new McpServer({ name: 'StrainEat', version: '1.0.0' }, { instructions: INSTRUCTIONS });
    const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o) }] });

    const item = z.object({
      name: z.string().describe('item name, English'),
      name_ar: z.string().optional().describe('item name, Arabic'),
      quantity: z.number().optional(),
      unit: z.string().optional().describe('piece, g, cup, serving…'),
      grams: z.number().optional().describe('estimated weight in grams'),
      calories: z.number(),
      protein_g: z.number(),
      carbs_g: z.number(),
      fat_g: z.number(),
      fiber_g: z.number().optional(),
      sugar_g: z.number().optional(),
      sodium_mg: z.number().optional(),
    });

    server.registerResource('StrainEat meal card', MEAL_CARD_URI, { description: 'Review card for a logged meal: items, amounts, macros and what is left today.', mimeType: RESOURCE_MIME_TYPE },
      async () => ({ contents: [{ uri: MEAL_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: mealCardHtml() }] }));
    // Both spellings: `ui.resourceUri` (current spec) and the legacy flat key older hosts read.
    const ui = (extra: Record<string, unknown> = {}) => ({ ui: { resourceUri: MEAL_CARD_URI, ...extra }, 'ui/resourceUri': MEAL_CARD_URI });

    server.registerTool('log_meal', {
      _meta: ui(),
      title: 'StrainEat: log a meal',
      description: 'Save a meal, snack or drink to StrainEat with per-item nutrition. Totals are recomputed from the items. If the user has logged this exact meal before, or the restaurant has published values, StrainEat uses those instead.',
      inputSchema: {
        meal_name: z.string(),
        meal_name_ar: z.string().optional(),
        restaurant: z.string().optional(),
        kind: z.enum(['meal', 'snack', 'drink']).optional(),
        eaten_at: z.string().optional().describe('ISO time; default now'),
        items: z.array(item).min(1),
        confirm: z.boolean().optional().describe('default true; false saves a draft the user reviews in the app'),
      },
    }, async (a) => {
      const restaurant = a.restaurant?.trim() || null;
      const known = (await this.repo.findKnownCandidates(userId, restaurant, a.meal_name)).find((k) => k.key === normalizeKey(restaurant, a.meal_name));
      const items: MealItem[] = known?.items?.length ? known.items : a.items.map((i) => ({
        name: i.name, name_ar: i.name_ar ?? i.name, quantity: i.quantity ?? 1, unit: i.unit ?? 'serving', grams: i.grams ?? null,
        calories: n(i.calories), protein_g: n(i.protein_g), carbs_g: n(i.carbs_g), fat_g: n(i.fat_g), fiber_g: n(i.fiber_g), sugar_g: n(i.sugar_g), sodium_mg: n(i.sodium_mg),
      }));
      let meal = await this.meals.createManual(userId, {
        meal_name: a.meal_name, meal_name_ar: a.meal_name_ar ?? a.meal_name, restaurant,
        source: known ? 'known_meal' : 'estimate', confidence: known ? 0.9 : 0.7, items, kind: a.kind,
        serving_description: 'via AI assistant', eatenAt: a.eaten_at,
      } as any);
      if (a.confirm !== false) meal = await this.meals.confirm(userId, meal.id);
      const t = meal.final.totals;
      const day = await this.today(userId).catch(() => null);
      this.log.log(`MCP log_meal ${userId.slice(0, 3)}… ${known ? 'known' : 'estimate'} ${Math.round(t.calories)} kcal`);
      const card = await this.card(userId, meal, base);
      return {
        ...text({
          saved: true, status: meal.status, usedSavedValues: !!known,
          meal: { name: meal.final.meal_name, kcal: Math.round(t.calories), protein_g: Math.round(t.protein_g), carbs_g: Math.round(t.carbs_g), fat_g: Math.round(t.fat_g) },
          today: day && { leftKcal: day.leftKcal, targetKcal: day.targetKcal, protein: day.protein },
          note: 'A StrainEat review card is shown to the user; they can adjust amounts or delete there.',
        }),
        structuredContent: card,
      };
    });

    // Card-only actions (hidden from the model; the card calls them).
    server.registerTool('meal_card_adjust', {
      title: 'StrainEat: adjust an item in the meal card',
      description: 'Scale one item of a logged meal (used by the review card).',
      inputSchema: { meal_id: z.string(), item_index: z.number().int().min(0), factor: z.number().min(0.1).max(10) },
      _meta: ui({ visibility: ['app'] }),
    }, async (a) => {
      const meal = await this.meals.get(userId, a.meal_id);
      const items: MealItem[] = [...(meal.final.items ?? [])];
      if (!items[a.item_index]) throw new Error('No such item');
      items[a.item_index] = scaleItem(items[a.item_index], a.factor);
      const updated = await this.meals.update(userId, a.meal_id, { items });
      const card = await this.card(userId, updated, base);
      return { ...text({ adjusted: true, kcal: Math.round(card.meal.totals.calories) }), structuredContent: card };
    });

    server.registerTool('meal_card_delete', {
      title: 'StrainEat: delete a meal from the card',
      description: 'Delete a logged meal (used by the review card).',
      inputSchema: { meal_id: z.string() },
      annotations: { destructiveHint: true },
      _meta: ui({ visibility: ['app'] }),
    }, async (a) => {
      await this.meals.remove(userId, a.meal_id);
      const day = await this.today(userId).catch(() => null);
      return { ...text({ deleted: true }), structuredContent: { deleted: true, today: day && { leftKcal: day.leftKcal, targetKcal: day.targetKcal, eatenKcal: day.eatenKcal, protein: day.protein } } };
    });

    server.registerTool('today_summary', {
      title: "StrainEat: today's calories left",
      description: "The user's live StrainEat numbers for today: calories left (remaining), target and eaten; protein/carbs/fat vs targets; burn; water; steps; fasting window; today's meals. Always call this for questions like 'how many calories do I have left', 'كم باقي لي سعرات', 'what should I eat next' — never estimate or answer from other tools.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => text(await this.today(userId)));

    server.registerTool('log_water', {
      title: 'StrainEat: log water',
      description: 'Add water the user drank (ml).',
      inputSchema: { ml: z.number().min(10).max(3000) },
    }, async (a) => {
      const w = await this.water.add(userId, { ml: a.ml });
      return text({ saved: true, drankMl: w.intakeMl, targetMl: w.targetMl });
    });

    server.registerTool('log_weight', {
      title: 'StrainEat: log weight',
      description: "Save today's body weight in kg.",
      inputSchema: { kg: z.number().min(25).max(350) },
    }, async (a) => {
      await this.plans.addWeight(userId, { kg: a.kg, source: 'manual' });
      return text({ saved: true, kg: a.kg });
    });

    return server;
  }
}
