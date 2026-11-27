import Anthropic from '@anthropic-ai/sdk';
import { BadGatewayException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeEstimate } from '../common/nutrition-math';
import { FETCH, FetchFn } from '../common/fetch';
import { AiUsageLog } from '../usage/ai-usage';
import { EMPTY_NUTRIENTS, KnownMeal, NutritionEstimate, SourceRef } from '../common/types';
import { buildSystemPrompt, buildUserText, CoachContext, SUBMIT_TOOL_NAME, SUBMIT_TOOL_SCHEMA } from './prompts';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/** Minimal surface of the SDK we use — makes the agent trivially mockable in tests. */
export interface MessagesClient {
  messages: { create(params: any): Promise<any> };
}

export interface AnalyzeInput {
  image?: Buffer | null;
  mediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** free-text description (typed or dictated), used with or without a photo */
  description?: string | null;
  mealName?: string | null;
  restaurant?: string | null;
  portion?: string | null;
  note?: string | null;
  city?: string | null;
  country?: string | null;
  known: KnownMeal[];
  coach?: CoachContext | null;
}

export interface AnalyzeResult {
  estimate: NutritionEstimate;
  searchesUsed: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

const MAX_TURNS = 8;

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface ChatTool { name: string; description: string; parameters: Record<string, unknown> }

@Injectable()
export class NutritionAgentService {
  private readonly log = new Logger(NutritionAgentService.name);
  private readonly model: string;
  private readonly maxSearches: number;
  private readonly defaultCountry: string;
  private readonly defaultCity: string | null;
  private readonly provider: 'anthropic' | 'gemini';
  private readonly geminiKey: string | undefined;
  private readonly geminiSearch: boolean;
  private readonly fallbackModel: string;
  private readonly fetchFn: FetchFn;

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: MessagesClient | null,
    config: ConfigService,
    @Optional() @Inject(FETCH) fetchFn?: FetchFn,
    @Optional() private readonly usage?: AiUsageLog,
  ) {
    const base = fetchFn ?? fetch;
    // Every Gemini request (incl. retries and fallbacks) is counted per user for the owner's usage page.
    this.fetchFn = (async (url: any, init?: any) => {
      const res = await base(url, init);
      const m = /generativelanguage\.googleapis\.com\/v1beta\/models\/([^:]+):generateContent/.exec(String(url));
      if (m && this.usage) {
        const model = decodeURIComponent(m[1]);
        const fallback = model !== this.model;
        if (res.ok) {
          res.clone().json().then(
            (d: any) => {
              const u = d?.usageMetadata ?? {};
              const searches = d?.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
              void this.usage!.record({ model, ok: true, fallback, inTok: u.promptTokenCount ?? 0, outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), searches });
            },
            () => void this.usage!.record({ model, ok: true, fallback, inTok: 0, outTok: 0, searches: 0 }),
          );
        } else {
          void this.usage.record({ model, ok: false, fallback, inTok: 0, outTok: 0, searches: 0 });
        }
      }
      return res;
    }) as FetchFn;
    this.geminiKey = config.get<string>('GEMINI_API_KEY')?.trim().replace(/^["']|["']$/g, '') || undefined;
    // LLM_PROVIDER wins; otherwise use Gemini when only a Gemini key is configured.
    const explicit = config.get<string>('LLM_PROVIDER');
    this.provider =
      explicit === 'gemini' || explicit === 'anthropic'
        ? explicit
        : !config.get<string>('ANTHROPIC_API_KEY') && this.geminiKey
          ? 'gemini'
          : 'anthropic';
    // Google Search grounding is not on the Gemini free tier; enable only on a paid project.
    this.geminiSearch = config.get<string>('GEMINI_GOOGLE_SEARCH') === 'true';
    this.fallbackModel = config.get<string>('GEMINI_FALLBACK_MODEL') ?? 'gemini-3.5-flash-lite';
    this.model =
      this.provider === 'gemini'
        ? (config.get<string>('GEMINI_MODEL') ?? 'gemini-3.6-flash')
        : (config.get<string>('CLAUDE_MODEL') ?? 'claude-sonnet-5-5');
    this.maxSearches = Number(config.get('WEB_SEARCH_MAX_USES') ?? 6);
    this.defaultCountry = config.get<string>('DEFAULT_COUNTRY') ?? 'AE';
    this.defaultCity = config.get<string>('DEFAULT_CITY') ?? null;
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (this.provider === 'gemini') return this.analyzeGemini(input);
    if (!this.client) throw new ServiceUnavailableException('No AI provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)');
    const client = this.client;
    const country = input.country ?? this.defaultCountry;
    const city = input.city ?? this.defaultCity;
    const system = buildSystemPrompt({ country, city, today: new Date().toISOString().slice(0, 10) });

    const tools: any[] = [
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: this.maxSearches,
        user_location: { type: 'approximate', country, ...(city ? { city } : {}) },
      },
      {
        type: 'web_fetch_20260318',
        name: 'web_fetch',
        max_uses: 3,
      },
      {
        name: SUBMIT_TOOL_NAME,
        description:
          'Submit the final nutrition analysis for the photographed meal. Call exactly once, after any research is done.',
        input_schema: SUBMIT_TOOL_SCHEMA,
      },
    ];

    const messages: any[] = [
      {
        role: 'user',
        content: [
          ...(input.image
            ? [{ type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.image.toString('base64') } }]
            : []),
          { type: 'text', text: buildUserText(input) },
        ],
      },
    ];

    const found = new Map<string, SourceRef>();
    let searches = 0;
    const usage = { input_tokens: 0, output_tokens: 0 };
    let forceSubmit = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system,
        tools,
        messages,
        ...(forceSubmit ? { tool_choice: { type: 'tool', name: SUBMIT_TOOL_NAME } } : {}),
      });
      usage.input_tokens += resp.usage?.input_tokens ?? 0;
      usage.output_tokens += resp.usage?.output_tokens ?? 0;

      for (const block of resp.content ?? []) {
        if (block.type === 'server_tool_use' && block.name === 'web_search') searches++;
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r?.url && !found.has(r.url)) found.set(r.url, { title: r.title ?? r.url, url: r.url });
          }
        }
      }

      const submit = (resp.content ?? []).find(
        (b: any) => b.type === 'tool_use' && b.name === SUBMIT_TOOL_NAME,
      );
      if (submit) {
        const raw = submit.input as NutritionEstimate;
        // Keep only cited URLs the search actually returned (or model-cited official pages if search was skipped).
        const cited = (raw.sources ?? []).filter((s) => found.size === 0 || found.has(s.url));
        // totals are always recomputed from items inside normalizeEstimate
        const estimate = normalizeEstimate({ ...raw, sources: cited, totals: raw.totals ?? { ...EMPTY_NUTRIENTS } });
        if (estimate.source === 'restaurant_published' && estimate.sources.length === 0) {
          estimate.warnings.push('Published source could not be verified — treat as estimate.');
          estimate.confidence = Math.min(estimate.confidence, 0.6);
        }
        return { estimate, searchesUsed: searches, model: this.model, usage };
      }

      if (resp.stop_reason === 'refusal') throw new Error('The model declined to analyse this image.');

      messages.push({ role: 'assistant', content: resp.content });
      if (resp.stop_reason !== 'pause_turn') {
        // Model finished talking without submitting — ask it to submit now.
        messages.push({
          role: 'user',
          content: `Now call ${SUBMIT_TOOL_NAME} with your best result (estimate if research was inconclusive).`,
        });
        forceSubmit = true;
      }
      this.log.debug(`turn ${turn} stop_reason=${resp.stop_reason}`);
    }
    throw new Error('Agent did not produce a result within the turn limit.');
  }

  /** One-shot Gemini call; if the main model is out of daily free quota or overloaded, retry on the lighter model. */
  private async geminiPost(body: unknown): Promise<Response> {
    const post = (model: string) =>
      this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.geminiKey! },
        body: JSON.stringify(body),
      });
    const res = await post(this.model);
    if (res.ok || !this.fallbackModel || this.fallbackModel === this.model) return res;
    if (res.status === 429 || res.status === 503 || res.status === 500) {
      const t = await res.text();
      const daily = /per_day|PerDay|free_tier_requests/i.test(t);
      if (res.status !== 429 || daily) {
        this.log.warn(`Gemini ${res.status} on ${this.model} → ${this.fallbackModel}`);
        return post(this.fallbackModel);
      }
      return new Response(t, { status: res.status });
    }
    return res;
  }

  /** Text-only structured call used by the coach (both providers). */
  async completeJson<T>(system: string, user: string, schema: object, maxTokens = 2500): Promise<T> {
    if (this.provider === 'gemini') {
      if (!this.geminiKey) throw new ServiceUnavailableException('GEMINI_API_KEY is not set');
      const res = await this.geminiPost({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.5, maxOutputTokens: maxTokens * 4 },
      });
      if (!res.ok) {
        const t = await res.text();
        this.log.warn(`Gemini ${res.status}: ${t.slice(0, 300)}`);
        if (res.status === 429) throw new ServiceUnavailableException('Gemini free-tier limit reached — try again shortly');
        throw new BadGatewayException(`Gemini error ${res.status}`);
      }
      const data: any = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
      try {
        return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
      } catch {
        throw new BadGatewayException('Coach returned no usable result');
      }
    }
    if (!this.client) throw new ServiceUnavailableException('No AI provider configured');
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      tools: [{ name: 'respond', description: 'Return the answer.', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'respond' },
      messages: [{ role: 'user', content: user }],
    });
    const block = (resp.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!block) throw new BadGatewayException('Coach returned no usable result');
    return block.input as T;
  }

  /**
   * Multi-turn chat where the model may call tools (read the user's data, propose actions).
   * Returns the final text reply. Works with Gemini (function calling) and Anthropic (tool use).
   */
  async chatWithTools(
    system: string,
    history: ChatTurn[],
    tools: ChatTool[],
    exec: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    maxRounds = 5,
  ): Promise<{ text: string; toolCalls: string[] }> {
    const called: string[] = [];
    if (this.provider === 'gemini') {
      if (!this.geminiKey) throw new ServiceUnavailableException('GEMINI_API_KEY is not set');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const contents: any[] = history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
      const declarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
      // Chat needs speed more than deep reasoning: keep thinking low (Gemini 3 uses levels, 2.5 uses budgets).
      const thinkingConfig = /^gemini-2\./.test(this.model) ? { thinkingBudget: 512 } : { thinkingLevel: 'low' };
      const fallback = this.fallbackModel;
      let model = this.model;
      const call = () =>
        this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.geminiKey! },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            tools: [{ functionDeclarations: declarations }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 4096, thinkingConfig },
          }),
        });
      for (let round = 0; round < maxRounds; round++) {
        let res = await call();
        if (res.status === 429) {
          // free tier: per-minute quota — wait the suggested delay once (capped) and retry
          const body = await res.text();
          this.log.warn(`Gemini chat 429: ${body.replace(/\s+/g, ' ').slice(0, 400)}`);
          const secs = Math.min(Number(/"retryDelay":\s*"(\d+)/.exec(body)?.[1] ?? 8), 20);
          if (/per_day|PerDay|free_tier_requests/i.test(body) && round === 0 && fallback && fallback !== model) {
            // daily free quota is per model: switch to the lighter model instead of waiting
            model = fallback;
            res = await call();
          } else {
            await new Promise((r) => setTimeout(r, secs * 1000));
            res = await call();
          }
        }
        if (res.status === 503 || res.status === 500) {
          // Google-side overload ("high demand"): retry once, then fall back to a lighter model on the first round
          this.log.warn(`Gemini chat ${res.status} on ${model}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 300)}`);
          await new Promise((r) => setTimeout(r, 1500));
          res = await call();
          if ((res.status === 503 || res.status === 500) && round === 0 && fallback && fallback !== model) {
            model = fallback;
            res = await call();
          }
        }
        if (!res.ok) {
          const t = await res.text();
          this.log.warn(`Gemini chat ${res.status} on ${model}: ${t.replace(/\s+/g, ' ').slice(0, 300)}`);
          if (res.status === 429) throw new ServiceUnavailableException('Gemini free-tier limit reached — try again shortly');
          if (res.status === 503 || res.status === 500) throw new ServiceUnavailableException('خدمة الذكاء الاصطناعي مزدحمة الآن، جرّب بعد دقيقة');
          if (res.status === 401 || res.status === 403 || (res.status === 400 && /API key/i.test(t))) throw new ServiceUnavailableException('مفتاح الذكاء الاصطناعي غير صالح — يجب تحديث GEMINI_API_KEY في الخادم');
          throw new BadGatewayException(`Gemini error ${res.status}`);
        }
        const data: any = await res.json();
        const content = data.candidates?.[0]?.content ?? { role: 'model', parts: [] };
        const parts: any[] = content.parts ?? [];
        const calls = parts.filter((p) => p.functionCall);
        if (!calls.length) return { text: parts.map((p) => p.text ?? '').join('').trim(), toolCalls: called };
        contents.push({ role: 'model', parts }); // keep thought signatures intact
        const responses = [];
        for (const c of calls) {
          called.push(c.functionCall.name);
          const out = await exec(c.functionCall.name, c.functionCall.args ?? {}).catch((e) => ({ error: String(e?.message ?? e) }));
          responses.push({ functionResponse: { name: c.functionCall.name, response: { result: out } } });
        }
        contents.push({ role: 'user', parts: responses });
      }
      return { text: '', toolCalls: called };
    }
    if (!this.client) throw new ServiceUnavailableException('No AI provider configured');
    const messages: any[] = history.map((t) => ({ role: t.role, content: t.text }));
    const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    for (let round = 0; round < maxRounds; round++) {
      const resp = await this.client.messages.create({ model: this.model, max_tokens: 2048, system, tools: anthropicTools, messages });
      const blocks: any[] = resp.content ?? [];
      const uses = blocks.filter((b) => b.type === 'tool_use');
      if (resp.stop_reason !== 'tool_use' || !uses.length) {
        return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(), toolCalls: called };
      }
      messages.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const u of uses) {
        called.push(u.name);
        const out = await exec(u.name, u.input ?? {}).catch((e) => ({ error: String(e?.message ?? e) }));
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: '', toolCalls: called };
  }

  /** Gemini (free tier friendly): single call, image + JSON schema output; optional Google Search grounding. */
  private async analyzeGemini(input: AnalyzeInput): Promise<AnalyzeResult> {
    if (!this.geminiKey) throw new ServiceUnavailableException('GEMINI_API_KEY is not set');
    const country = input.country ?? this.defaultCountry;
    const city = input.city ?? this.defaultCity;
    const system = buildSystemPrompt({
      country,
      city,
      today: new Date().toISOString().slice(0, 10),
      webSearch: this.geminiSearch,
      jsonOnly: true,
    });
    const body: any = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: 'user',
          parts: [
            ...(input.image ? [{ inline_data: { mime_type: input.mediaType, data: input.image.toString('base64') } }] : []),
            { text: buildUserText(input) },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: SUBMIT_TOOL_SCHEMA,
        temperature: 0.2,
      },
      ...(this.geminiSearch ? { tools: [{ google_search: {} }] } : {}),
    };
    const res = await this.geminiPost(body);
    if (!res.ok) {
      const text = await res.text();
      this.log.warn(`Gemini ${res.status}: ${text.slice(0, 500)}`);
      if (res.status === 429) throw new ServiceUnavailableException('Gemini free-tier limit reached — try again shortly');
      throw new BadGatewayException(`Gemini error ${res.status}`);
    }
    const data: any = await res.json();
    const cand = data.candidates?.[0];
    const text: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    let raw: NutritionEstimate;
    try {
      raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new BadGatewayException(`Gemini returned no usable result (${cand?.finishReason ?? 'unknown'})`);
    }
    // Grounding sources (only when Google Search is enabled)
    const found = new Map<string, SourceRef>();
    for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
      if (c.web?.uri) found.set(c.web.uri, { title: c.web.title ?? c.web.uri, url: c.web.uri });
    }
    const cited = this.geminiSearch
      ? [...(raw.sources ?? []).filter((s) => found.has(s.url)), ...(found.size && !(raw.sources ?? []).some((s) => found.has(s.url)) ? [...found.values()].slice(0, 3) : [])]
      : []; // no search → no verifiable URLs
    const estimate = normalizeEstimate({ ...raw, sources: cited, totals: { ...EMPTY_NUTRIENTS } });
    if (estimate.source === 'restaurant_published' && estimate.sources.length === 0) {
      estimate.warnings.push('Published values recalled without a live source — please verify.');
      estimate.confidence = Math.min(estimate.confidence, 0.6);
    }
    const u = data.usageMetadata ?? {};
    return {
      estimate,
      searchesUsed: this.geminiSearch ? (cand?.groundingMetadata?.webSearchQueries?.length ?? 0) : 0,
      model: this.model,
      usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: u.candidatesTokenCount ?? 0 },
    };
  }
}

export function anthropicFactory(config: ConfigService): MessagesClient | null {
  const apiKey = config.get<string>('ANTHROPIC_API_KEY');
  return apiKey ? (new Anthropic({ apiKey }) as unknown as MessagesClient) : null;
}
