import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { SUBMIT_TOOL_NAME } from '../src/agent/prompts';
import { dayBoundsUtc, localDate } from '../src/common/dates';
import { normalizeEstimate, normalizeKey, scaleEstimate } from '../src/common/nutrition-math';
import { EMPTY_NUTRIENTS, NutritionEstimate } from '../src/common/types';
import { EnergyService } from '../src/energy/energy.service';
import { WhoopService } from '../src/integrations/whoop/whoop.service';
import { MealsService } from '../src/meals/meals.service';
import { ProfileService } from '../src/profile/profile.service';
import { PlanService } from '../src/plan/plan.service';
import { dedupeWorkouts, sportInfo, WorkoutsService } from '../src/workouts/workouts.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const config = (extra: Record<string, string> = {}) =>
  new ConfigService({ CLAUDE_MODEL: 'claude-sonnet-5-5', OAUTH_STATE_SECRET: 'x'.repeat(32), ...extra });

const item = (o: Partial<any> = {}) => ({
  name: 'Chicken shawarma wrap',
  name_ar: 'شاورما دجاج',
  quantity: 1,
  unit: 'piece',
  grams: 250,
  calories: 520,
  protein_g: 32,
  carbs_g: 48,
  fat_g: 22,
  fiber_g: 3,
  sugar_g: 4,
  sodium_mg: 1100,
  ...o,
});

const submission = (o: Partial<NutritionEstimate> = {}) => ({
  meal_name: 'Chicken shawarma wrap',
  meal_name_ar: 'ساندويتش شاورما دجاج',
  restaurant: 'Test Grill',
  source: 'restaurant_published',
  confidence: 0.92,
  serving_description: '1 regular wrap',
  items: [item()],
  sources: [{ title: 'Test Grill nutrition', url: 'https://testgrill.ae/nutrition' }],
  assumptions: ['regular size'],
  warnings: [],
  ...o,
});

/** Fake Claude: turn 1 searches + pauses, turn 2 submits. Records requests. */
function fakeClaude(sub = submission()) {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: vi.fn(async (p: any) => {
        calls.push(JSON.parse(JSON.stringify(p)));
        if (calls.length === 1) {
          return {
            stop_reason: 'pause_turn',
            usage: { input_tokens: 1000, output_tokens: 50 },
            content: [
              { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Test Grill shawarma calories' } },
              {
                type: 'web_search_tool_result',
                tool_use_id: 's1',
                content: [{ type: 'web_search_result', url: 'https://testgrill.ae/nutrition', title: 'Nutrition' }],
              },
            ],
          };
        }
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 1200, output_tokens: 300 },
          content: [{ type: 'tool_use', id: 't1', name: SUBMIT_TOOL_NAME, input: sub }],
        };
      }),
    },
  };
}

function setup(claude = fakeClaude()) {
  const repo = new MemoryRepository();
  const cfg = config();
  const profiles = new ProfileService(repo);
  const agent = new NutritionAgentService(claude, cfg);
  const plans = new PlanService(repo, profiles);
  const meals = new MealsService(repo, agent, profiles, plans);
  const workouts = new WorkoutsService(repo, profiles);
  const energy = new EnergyService(repo, profiles, plans, workouts);
  return { repo, cfg, profiles, agent, meals, energy, plans, workouts, claude };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('nutrition math', () => {
  it('recomputes totals from items and flags macro mismatch', () => {
    const e = normalizeEstimate({
      ...(submission() as any),
      items: [item(), item({ calories: 900 })],
      totals: { ...EMPTY_NUTRIENTS, calories: 1 },
    });
    expect(e.totals.calories).toBe(1420);
    expect(e.totals.protein_g).toBe(64);
    expect(e.warnings.some((w) => w.startsWith('[check]'))).toBe(true);
  });

  it('scales portions', () => {
    const e = scaleEstimate(normalizeEstimate({ ...(submission() as any), totals: EMPTY_NUTRIENTS }), 0.5);
    expect(e.totals.calories).toBe(260);
    expect(e.items[0].grams).toBe(125);
  });

  it('normalizes Arabic/English keys', () => {
    expect(normalizeKey('مطعم الأمير', 'شاورما  دجاج')).toBe(normalizeKey('مطعم الامير', 'شاورما دجاج'));
    expect(normalizeKey('McDonald’s', 'Big Mac')).toBe('mcdonald s|big mac');
  });

  it('computes Dubai day bounds', () => {
    const b = dayBoundsUtc('2026-11-20', 'Asia/Dubai');
    expect(b.start.toISOString()).toBe('2026-11-19T20:00:00.000Z');
    expect(localDate(new Date('2026-11-19T21:00:00Z'), 'Asia/Dubai')).toBe('2026-11-20');
  });
});

describe('agent', () => {
  it('handles pause_turn, sends image + tools, keeps only verified sources', async () => {
    const claude = fakeClaude(
      submission({ sources: [{ title: 'ok', url: 'https://testgrill.ae/nutrition' }, { title: 'made up', url: 'https://fake.example/x' }] }),
    );
    const { agent } = setup(claude);
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', restaurant: 'Test Grill', known: [] });
    expect(claude.calls).toHaveLength(2);
    const first = claude.calls[0];
    expect(first.model).toBe('claude-sonnet-5-5');
    expect(first.messages[0].content[0].type).toBe('image');
    expect(first.tools.map((t: any) => t.type ?? t.name)).toEqual(['web_search_20260318', 'web_fetch_20260318', SUBMIT_TOOL_NAME]);
    expect(first.tools[0].user_location.country).toBe('AE');
    expect(claude.calls[1].messages).toHaveLength(2); // assistant pause content appended
    expect(r.searchesUsed).toBe(1);
    expect(r.estimate.sources).toEqual([{ title: 'ok', url: 'https://testgrill.ae/nutrition' }]);
    expect(r.estimate.totals.calories).toBe(520);
  });

  it('forces submit when the model ends without calling the tool', async () => {
    const calls: any[] = [];
    const client = {
      messages: {
        create: vi.fn(async (p: any) => {
          calls.push(p);
          if (calls.length === 1) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Looks like kabsa' }] };
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 't',
                name: SUBMIT_TOOL_NAME,
                input: submission({ source: 'estimate', restaurant: null, sources: [], confidence: 0.5 }),
              },
            ],
          };
        }),
      },
    };
    const agent = new NutritionAgentService(client, config());
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(calls[1].tool_choice).toEqual({ type: 'tool', name: SUBMIT_TOOL_NAME });
    expect(r.estimate.source).toBe('estimate');
  });

  it('downgrades unverifiable "published" claims', async () => {
    const claude = fakeClaude(submission({ sources: [] }));
    const r = await setup(claude).agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(r.estimate.confidence).toBeLessThanOrEqual(0.6);
    expect(r.estimate.warnings.join(' ')).toMatch(/could not be verified/);
  });
});

describe('meals flow + learning', () => {
  it('analyze → edit → confirm teaches the agent; next analysis receives known meal', async () => {
    const s = setup();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', { restaurant: 'Test Grill', mealName: 'shawarma' });
    expect(meal.status).toBe('draft');

    const edited = await s.meals.update('u1', meal.id, { items: [item({ calories: 600, fat_g: 30 })] });
    expect(edited.final.totals.calories).toBe(600);
    expect(edited.estimate.totals.calories).toBe(520); // original kept
    await s.meals.confirm('u1', meal.id);

    const known = await s.repo.findKnownCandidates('u1', 'Test Grill', 'Chicken shawarma wrap');
    expect(known[0].totals.calories).toBe(600);
    expect(known[0].source).toBe('known_meal');
    // edited → not promoted to global
    expect(await s.repo.getKnown(null, normalizeKey('Test Grill', 'Chicken shawarma wrap'))).toBeNull();

    s.claude.calls.length = 0;
    await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', { restaurant: 'test grill', mealName: 'chicken shawarma' });
    const userText = s.claude.calls[0].messages[0].content[1].text;
    expect(userText).toContain('KNOWN MEALS');
    expect(userText).toContain('600 kcal');
  });

  it('unedited verified published meals become global knowledge', async () => {
    const s = setup();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', {});
    await s.meals.confirm('u1', meal.id);
    const g = await s.repo.getKnown(null, normalizeKey('Test Grill', 'Chicken shawarma wrap'));
    expect(g?.source).toBe('restaurant_published');
    // another user benefits
    const forU2 = await s.repo.findKnownCandidates('u2', 'Test Grill', 'shawarma wrap');
    expect(forU2).toHaveLength(1);
  });

  it('rejects non-images and isolates users', async () => {
    const s = setup();
    await expect(s.meals.analyzePhoto('u1', JPEG, 'application/pdf', {})).rejects.toThrow();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', {});
    await expect(s.meals.get('u2', meal.id)).rejects.toThrow();
  });
});

describe('energy balance', () => {
  it('uses one source per day (no double counting) and computes remaining', async () => {
    const s = setup();
    await s.profiles.update('u1', { goal: 'lose' });
    const date = '2026-11-15';
    await s.energy.ingest('u1', [
      { date, source: 'apple_health', activeKcal: 600, basalKcal: 1600 },
      { date, source: 'whoop', totalKcal: 2400 },
    ]);
    const m = await s.meals.createManual('u1', { meal_name: 'Lunch', items: [item()], eatenAt: '2026-11-15T09:00:00Z' });
    await s.meals.confirm('u1', m.id);
    const b = await s.energy.balance('u1', date);
    expect(b.burn?.source).toBe('whoop');
    expect(b.burn?.totalKcal).toBe(2400);
    expect(b.intake.calories).toBe(520);
    // plan: no weight yet → conservative −400 from formula fallback (2000)
    expect(b.targetIntakeKcal).toBe(1600);
    expect(b.remainingKcal).toBe(1080);
    expect(b.macroTargets.protein_g).toBeGreaterThan(0);

    await s.profiles.update('u1', { preferredEnergySource: 'apple_health' });
    expect((await s.energy.balance('u1', date)).burn?.totalKcal).toBe(2200);
  });

  it('targets maintenance from Mifflin-St Jeor when there is no device data', async () => {
    const s = setup();
    await s.profiles.update('u1', { sex: 'female', birthYear: 2000, heightCm: 165, weightKg: 60, activityLevel: 'light' });
    const b = await s.energy.balance('u1', '2026-11-01');
    // BMR = 600 + 1031.25 - 130 - 161 = 1340 → ×1.375 = 1843 → maintain → 1840
    expect(b.burn).toBeNull();
    expect(b.targetIntakeKcal).toBe(1840);
  });
});

describe('WHOOP', () => {
  it('OAuth state round-trip, sync converts kJ → kcal per local day, refreshes on 401', async () => {
    const s = setup();
    const cfg = config({
      WHOOP_CLIENT_ID: 'cid',
      WHOOP_CLIENT_SECRET: 'sec',
      WHOOP_REDIRECT_URI: 'https://api.test/integrations/whoop/callback',
    });
    let cycleCalls = 0;
    const fetchFn: any = vi.fn(async (url: string, init?: any): Promise<any> => {
      if (url.includes('/oauth2/token')) {
        const body = new URLSearchParams(init.body);
        return json({ access_token: body.get('grant_type') === 'refresh_token' ? 'A2' : 'A1', refresh_token: 'R1', expires_in: 3600 });
      }
      if (url.includes('/v2/activity/workout')) {
        return json({
          records: [
            {
              id: 'w-1', start: '2026-11-15T14:00:00Z', end: '2026-11-15T14:45:00Z', sport_name: 'running', score_state: 'SCORED',
              score: { strain: 11.234, average_heart_rate: 152, max_heart_rate: 178, kilojoule: 2092, distance_meter: 7012.4,
                zone_durations: { zone_zero_milli: 0, zone_one_milli: 300000, zone_two_milli: 600000, zone_three_milli: 1200000, zone_four_milli: 540000, zone_five_milli: 60000 } },
            },
          ],
        });
      }
      if (url.includes('/v2/activity/sleep')) {
        return json({ records: [
          { id: 's-1', start: '2026-11-14T20:10:00Z', end: '2026-11-15T03:05:00Z', nap: false, score_state: 'SCORED',
            score: { stage_summary: { total_in_bed_time_milli: 24900000, total_awake_time_milli: 1500000, total_light_sleep_time_milli: 11700000, total_slow_wave_sleep_time_milli: 5400000, total_rem_sleep_time_milli: 6300000, disturbance_count: 9 },
              sleep_needed: { baseline_milli: 27000000, need_from_sleep_debt_milli: 1800000, need_from_recent_strain_milli: 600000, need_from_recent_nap_milli: 0 },
              respiratory_rate: 15.92, sleep_performance_percentage: 72, sleep_consistency_percentage: 64, sleep_efficiency_percentage: 93.9 } },
          { id: 's-nap', start: '2026-11-15T10:00:00Z', end: '2026-11-15T10:30:00Z', nap: true, score_state: 'SCORED', score: { stage_summary: {} } },
        ] });
      }
      if (url.includes('/v2/recovery')) {
        return json({ records: [{ cycle_id: 1, sleep_id: 's-1', created_at: '2026-11-15T03:10:00Z', score_state: 'SCORED',
          score: { user_calibrating: false, recovery_score: 76, resting_heart_rate: 56, hrv_rmssd_milli: 37.4, spo2_percentage: 95.2, skin_temp_celsius: 33.71 } }] });
      }
      if (url.includes('/v2/cycle')) {
        cycleCalls++;
        if (init.headers.Authorization === 'Bearer A1') return { ok: false, status: 401, text: async () => 'expired' };
        return json({
          records: [
            // Dubai: sleep 23:00 Nov 14 → 23:30 Nov 15 ⇒ Nov 15
            { id: 1, start: '2026-11-14T19:00:00Z', end: '2026-11-15T19:30:00Z', score_state: 'SCORED', score: { kilojoule: 10460, strain: 10 } },
            { id: 2, start: '2026-11-15T19:30:00Z', end: null, score_state: 'PENDING_SCORE' },
          ],
        });
      }
      throw new Error('unexpected ' + url);
    });
    const whoop = new WhoopService(cfg, s.repo, s.energy, s.profiles, fetchFn);
    const url = new URL(whoop.authorizeUrl('u1'));
    expect(url.searchParams.get('scope')).toContain('read:cycles');
    expect(await whoop.handleCallback('code', url.searchParams.get('state')!)).toBe('u1');
    await expect(whoop.handleCallback('code', 'tampered.sig')).rejects.toThrow();

    const r = await whoop.sync('u1', '2026-11-15', '2026-11-15');
    expect(cycleCalls).toBe(2); // 401 then retry with refreshed token
    expect(r.days).toEqual({ '2026-11-15': 2500 });
    const b = await s.energy.balance('u1', '2026-11-15');
    expect(b.burn).toMatchObject({ source: 'whoop', totalKcal: 2500 });
    expect(r.workouts).toBe(1);
    expect(b.activity.workouts[0]).toMatchObject({ sport: 'running', sportAr: 'جري', kind: 'run', durationMin: 45, kcal: 500, strain: 11.2, avgHr: 152, distanceM: 7012 });
    expect(b.activity.workouts[0].zonesMin).toEqual([0, 5, 10, 20, 9, 1]);
    expect(b.activity).toMatchObject({ totalMin: 45, totalKcal: 500, maxStrain: 11.2 });
    expect(url.searchParams.get('scope')).toContain('read:recovery');
    const w: any = await whoop.wellness('u1', '2026-11-15', 2);
    expect(w.needsReconnect).toBe(false);
    expect(w.today).toMatchObject({ date: '2026-11-15', recovery: 76, restingHr: 56, hrv: 37, spo2: 95.2, skinTemp: 33.7, strain: 10,
      sleepMin: 390, deepMin: 90, remMin: 105, lightMin: 195, awakeMin: 25, sleepNeededMin: 490, sleepPerformance: 72, sleepEfficiency: 94, respiratoryRate: 15.9 });
    expect(w.days).toHaveLength(2);
  });

  it('flags reconnect when recovery/sleep scopes are missing', async () => {
    const s = setup();
    const cfg = config({ WHOOP_CLIENT_ID: 'cid', WHOOP_CLIENT_SECRET: 'sec', WHOOP_REDIRECT_URI: 'https://api.test/cb' });
    const fetchFn: any = vi.fn(async (u: string): Promise<any> => {
      if (u.includes('/oauth2/token')) return json({ access_token: 'A', refresh_token: 'R', expires_in: 3600 });
      if (u.includes('/v2/recovery') || u.includes('/v2/activity/sleep')) return { ok: false, status: 403, text: async () => 'scope' };
      return json({ records: [] });
    });
    const whoop = new WhoopService(cfg, s.repo, s.energy, s.profiles, fetchFn);
    const url = new URL(whoop.authorizeUrl('u2'));
    await whoop.handleCallback('c', url.searchParams.get('state')!);
    await whoop.sync('u2', '2026-11-15', '2026-11-15');
    expect((await whoop.wellness('u2', '2026-11-15')).needsReconnect).toBe(true);
  });
});

function json(o: any): any {
  return { ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) };
}

describe('Gemini provider (free tier)', () => {
  const geminiResponse = (sub: any) => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(sub) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200 },
    }),
    text: async () => '',
  });

  it('is chosen automatically when only GEMINI_API_KEY is set; sends image + JSON schema, no search tool', async () => {
    const calls: any[] = [];
    const fetchFn: any = vi.fn(async (url: string, init: any): Promise<any> => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return geminiResponse(submission({ source: 'estimate', restaurant: null, sources: [{ title: 'x', url: 'https://made.up' }] }));
    });
    const agent = new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'g-key' }), fetchFn);
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', mealName: 'kabsa', known: [] });
    expect(calls[0].url).toContain('/models/gemini-3.6-flash:generateContent');
    expect(calls[0].init.headers['x-goog-api-key']).toBe('g-key');
    expect(calls[0].body.contents[0].parts[0].inline_data.mime_type).toBe('image/jpeg');
    expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[0].body.generationConfig.responseJsonSchema.required).toContain('items');
    expect(calls[0].body.tools).toBeUndefined();
    expect(calls[0].body.systemInstruction.parts[0].text).toContain('WEB SEARCH IS NOT AVAILABLE');
    expect(r.model).toBe('gemini-3.6-flash');
    expect(r.estimate.sources).toEqual([]); // invented URL dropped
    expect(r.estimate.totals.calories).toBe(520);
  });

  it('downgrades recalled "published" values and maps 429 to a friendly error', async () => {
    let n = 0;
    const fetchFn: any = vi.fn(async (): Promise<any> =>
      ++n === 1 ? geminiResponse(submission()) : { ok: false, status: 429, text: async () => 'quota' },
    );
    const agent = new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'k' }), fetchFn);
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(r.estimate.confidence).toBeLessThanOrEqual(0.6);
    await expect(agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] })).rejects.toThrow(/limit/);
  });

  it('enables Google Search grounding only when GEMINI_GOOGLE_SEARCH=true and keeps grounded URLs', async () => {
    const fetchFn: any = vi.fn(async (_u: string, init: any): Promise<any> => {
      expect(JSON.parse(init.body).tools).toEqual([{ google_search: {} }]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(submission({ sources: [] })) }] },
              groundingMetadata: {
                webSearchQueries: ['test grill shawarma calories'],
                groundingChunks: [{ web: { uri: 'https://testgrill.ae/nutrition', title: 'Nutrition' } }],
              },
            },
          ],
        }),
      };
    });
    const agent = new NutritionAgentService(null, new ConfigService({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_GOOGLE_SEARCH: 'true' }), fetchFn);
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(r.searchesUsed).toBe(1);
    expect(r.estimate.sources[0].url).toBe('https://testgrill.ae/nutrition');
    expect(r.estimate.confidence).toBeGreaterThan(0.9);
  });

  it('fails clearly when no provider key is configured', async () => {
    const agent = new NutritionAgentService(null, new ConfigService({}));
    await expect(agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] })).rejects.toThrow(/No AI provider/);
  });
});

describe('workouts', () => {
  it('maps WHOOP and HealthKit sport names to Arabic', () => {
    expect(sportInfo('functional-fitness')).toEqual({ ar: 'لياقة وظيفية', kind: 'strength' });
    expect(sportInfo('traditionalStrengthTraining').kind).toBe('strength');
    expect(sportInfo('Padel').ar).toBe('بادل');
    expect(sportInfo('underwater-hockey').ar).toBe('underwater hockey');
  });

  it('Apple Health ingest + dedupe of the same session recorded by WHOOP', async () => {
    const s = setup();
    await s.workouts.ingest('u1', 'apple_health', [
      { externalId: 'hk-1', sport: 'running', start: '2026-11-15T14:02:00Z', end: '2026-11-15T14:44:00Z', kcal: 480, avgHr: 150 },
      { externalId: 'hk-2', sport: 'yoga', start: '2026-11-15T17:00:00Z', end: '2026-11-15T17:30:00Z', kcal: 90 },
    ]);
    await s.repo.upsertWorkout({ userId: 'u1', id: 'whoop:w-1', source: 'whoop', sport: 'running', start: '2026-11-15T14:00:00Z', end: '2026-11-15T14:45:00Z', date: '2026-11-15', durationMin: 45, kcal: 500, strain: 11, avgHr: 152, maxHr: 178, distanceM: 7000, zonesMin: null, updatedAt: '' });
    const d = await s.workouts.forDay('u1', '2026-11-15');
    expect(d.workouts.map((w: any) => w.id)).toEqual(['whoop:w-1', 'apple_health:hk-2']);
    await s.profiles.update('u1', { preferredEnergySource: 'apple_health' });
    const d2 = await s.workouts.forDay('u1', '2026-11-15');
    expect(d2.workouts.map((w: any) => w.id)).toEqual(['apple_health:hk-1', 'apple_health:hk-2']);
    await expect(s.workouts.ingest('u1', 'apple_health', [{ externalId: 'x', sport: 'run', start: '2026-11-15T15:00:00Z', end: '2026-11-15T14:00:00Z' }])).rejects.toThrow();
    await expect(s.workouts.ingest('u1', 'whoop' as any, [])).rejects.toThrow();
  });

  it('dedupe keeps both when they do not overlap enough', () => {
    const w = (id: string, source: any, s: string, e: string) => ({ userId: 'u', id, source, sport: 'x', start: s, end: e, date: '2026-11-15', durationMin: 0, kcal: null, strain: null, avgHr: null, maxHr: null, distanceM: null, zonesMin: null, updatedAt: '' });
    const out = dedupeWorkouts([w('a', 'whoop', '2026-11-15T10:00:00Z', '2026-11-15T11:00:00Z'), w('b', 'apple_health', '2026-11-15T10:50:00Z', '2026-11-15T11:50:00Z')], null);
    expect(out).toHaveLength(2);
  });
});
