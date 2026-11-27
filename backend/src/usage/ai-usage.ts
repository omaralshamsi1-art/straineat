import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { REPOSITORY, Repository } from '../storage/repository';

/** What triggered a model call. */
export type AiKind = 'photo' | 'text' | 'chat' | 'coach' | 'other';
export interface AiCtx { userId: string; kind: AiKind; counted?: boolean }

/** Per-request context so a Gemini call deep in the agent knows which user/feature it is for. */
export const aiContext = new AsyncLocalStorage<AiCtx>();

export function kindForPath(path: string): AiKind | null {
  if (path.startsWith('/meals/analyze-text')) return 'text';
  if (path.startsWith('/meals/analyze')) return 'photo';
  if (path.startsWith('/assistant')) return 'chat';
  if (path.startsWith('/coach')) return 'coach';
  return null;
}

/** Runs AI endpoints inside an aiContext (after the auth guard has set req.userId). */
@Injectable()
export class AiContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const kind = req?.path ? kindForPath(String(req.path)) : null;
    if (!kind || !req.userId) return next.handle();
    return new Observable((sub) => aiContext.run({ userId: String(req.userId), kind }, () => next.handle().subscribe(sub)));
  }
}

export interface UsageCounters {
  photo: number; text: number; chat: number; coach: number; other: number; // user actions that reached the model
  req: number; fail: number; fallback: number; // upstream model requests
  in: number; out: number; search: number; cost: number;
}
const ZERO = (): UsageCounters => ({ photo: 0, text: 0, chat: 0, coach: 0, other: 0, req: 0, fail: 0, fallback: 0, in: 0, out: 0, search: 0, cost: 0 });

/** USD per 1M tokens (paid tier, Nov 2026) — estimate only. */
export function priceFor(model: string): { in: number; out: number } {
  if (/lite/i.test(model)) return { in: 0.3, out: 2.5 };
  return { in: 0.75, out: 3.75 };
}
export const SEARCH_USD = 0.014; // per grounded search query beyond the free monthly allowance

export const USAGE_OWNER = '__usage__';
const TZ = process.env.USAGE_TZ || 'Asia/Dubai';
export function usageDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export interface ModelCall { model: string; ok: boolean; fallback: boolean; inTok: number; outTok: number; searches: number }

/** Aggregates every upstream model call per day and user (counts only — no content). */
@Injectable()
export class AiUsageLog {
  private readonly log = new Logger('AiUsage');
  private chain: Promise<unknown> = Promise.resolve();
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  record(call: ModelCall, ctx: AiCtx | undefined = aiContext.getStore()) {
    const userId = ctx?.userId ?? 'system';
    const kind: AiKind = ctx?.kind ?? 'other';
    const firstForAction = ctx ? !ctx.counted : true;
    if (ctx) ctx.counted = true;
    const p = priceFor(call.model);
    const cost = (call.inTok * p.in + call.outTok * p.out) / 1e6 + call.searches * SEARCH_USD;
    this.log.log(`${userId.slice(0, 6)} ${kind} ${call.model} ${call.ok ? 'ok' : 'fail'}${call.fallback ? ' (fallback)' : ''} in=${call.inTok} out=${call.outTok} search=${call.searches}`);
    const day = usageDay();
    const job = this.chain.then(async () => {
      const cur = ((await this.repo.getCache(USAGE_OWNER, `day:${day}`))?.payload as { users?: Record<string, UsageCounters> }) ?? {};
      const users = cur.users ?? {};
      const u = { ...ZERO(), ...(users[userId] ?? {}) };
      if (firstForAction) u[kind] += 1;
      u.req += 1;
      if (!call.ok) u.fail += 1;
      if (call.fallback) u.fallback += 1;
      u.in += call.inTok; u.out += call.outTok; u.search += call.searches; u.cost = Math.round((u.cost + cost) * 1e6) / 1e6;
      users[userId] = u;
      await this.repo.setCache({ userId: USAGE_OWNER, key: `day:${day}`, payload: { users }, createdAt: new Date().toISOString() });
    });
    this.chain = job.catch((e) => this.log.warn(`usage write failed: ${e?.message ?? e}`));
    return job.catch(() => undefined);
  }

  async days(n: number): Promise<{ date: string; users: Record<string, UsageCounters> }[]> {
    const out: { date: string; users: Record<string, UsageCounters> }[] = [];
    for (let i = 0; i < n; i++) {
      const date = usageDay(new Date(Date.now() - i * 86400_000));
      const e = await this.repo.getCache(USAGE_OWNER, `day:${date}`);
      out.push({ date, users: ((e?.payload as any)?.users ?? {}) as Record<string, UsageCounters> });
    }
    return out;
  }

  /** Account deletion: drop the user's counters from recent days. */
  async forget(userId: string, n = 40) {
    for (const d of await this.days(n)) {
      if (!d.users[userId]) continue;
      delete d.users[userId];
      await this.repo.setCache({ userId: USAGE_OWNER, key: `day:${d.date}`, payload: { users: d.users }, createdAt: new Date().toISOString() });
    }
  }

  static sum(list: UsageCounters[]): UsageCounters {
    const t = ZERO();
    for (const u of list) for (const k of Object.keys(t) as (keyof UsageCounters)[]) t[k] += u[k] ?? 0;
    t.cost = Math.round(t.cost * 1e4) / 1e4;
    return t;
  }
}
