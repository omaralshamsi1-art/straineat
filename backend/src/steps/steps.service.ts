import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { ageOf, ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { addDays } from '../plan/plan.service';

/**
 * Daily steps goal. Paluch et al., Lancet Public Health 2022 (15 cohorts): mortality risk kept falling
 * with more steps until ~8,000–10,000/day under 60 and ~6,000–8,000/day at 60+.
 * The goal ramps toward that level from the user's own 7-day average (+1,000 at a time, never below 4,000),
 * so someone at 3,000 steps isn't handed 10,000 on day one.
 */
export function stepGoal(age: number | null, avg7: number | null): { goal: number; fullGoal: number } {
  const fullGoal = age != null && age >= 60 ? 7000 : 9000;
  if (avg7 == null || avg7 <= 0) return { goal: fullGoal, fullGoal };
  const ramp = Math.max(4000, Math.ceil((avg7 + 1000) / 500) * 500);
  return { goal: Math.min(fullGoal, ramp), fullGoal };
}

type StepDay = { steps: number; source: string; updatedAt: string; sources?: Record<string, { steps: number; at: string }> };

export const STEP_SOURCE_NAMES: Record<string, [string, string]> = {
  whoop: ['WHOOP', 'WHOOP'],
  apple_health: ['Apple Health', 'Apple Health'],
  shortcut: ['Shortcut', 'الاختصار'],
};

/** Each source keeps its own latest count for the day; the day shows the highest (different devices miss different steps). */
export function mergeSteps(prev: StepDay | null, source: string, steps: number, at: string): StepDay {
  const sources = { ...(prev?.sources ?? (prev ? { [prev.source]: { steps: prev.steps, at: prev.updatedAt } } : {})) };
  sources[source] = { steps, at };
  const [best, v] = Object.entries(sources).sort((a, b) => b[1].steps - a[1].steps)[0];
  return { steps: v.steps, source: best, updatedAt: v.at, sources };
}

@Injectable()
export class StepsService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
  ) {}

  async ingest(userId: string, samples: { date?: unknown; steps?: unknown }[], source = 'apple_health') {
    if (!(source in STEP_SOURCE_NAMES)) source = 'apple_health';
    if (!Array.isArray(samples) || !samples.length) throw new BadRequestException('samples[] required');
    let saved = 0;
    for (const s of samples.slice(0, 31)) {
      const date = String(s?.date ?? '');
      const steps = Math.round(Number(s?.steps));
      if (!isIsoDate(date) || !Number.isFinite(steps) || steps < 0 || steps > 150000) throw new BadRequestException('each sample needs date and steps');
      const at = new Date().toISOString();
      const merged = mergeSteps(await this.get(userId, date), source, steps, at);
      await this.repo.setCache({ userId, key: `steps:${date}`, payload: merged, createdAt: at });
      saved++;
    }
    return { saved };
  }

  private async get(userId: string, date: string): Promise<StepDay | null> {
    return ((await this.repo.getCache(userId, `steps:${date}`))?.payload as StepDay) ?? null;
  }

  async day(userId: string, date?: string) {
    const p = await this.profiles.get(userId);
    const today = localDate(new Date(), p.timezone);
    const d = date ?? today;
    if (!isIsoDate(d)) throw new BadRequestException('date must be YYYY-MM-DD');
    const prev = (await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => this.get(userId, addDays(d, -i))))).filter((x): x is StepDay => !!x && x.steps > 0);
    const avg7 = prev.length >= 3 ? Math.round(prev.reduce((a, x) => a + x.steps, 0) / prev.length) : null;
    const { goal, fullGoal } = stepGoal(ageOf(p), avg7);
    const cur = await this.get(userId, d);
    const sources = Object.entries(cur?.sources ?? {}).map(([k, v]) => ({ source: k, name: STEP_SOURCE_NAMES[k]?.[0] ?? k, name_ar: STEP_SOURCE_NAMES[k]?.[1] ?? k, steps: v.steps, at: v.at }))
      .sort((a, b) => b.steps - a.steps);
    return { date: d, steps: cur?.steps ?? null, source: cur?.source ?? null, sourceName: cur ? STEP_SOURCE_NAMES[cur.source]?.[0] ?? cur.source : null,
      sourceName_ar: cur ? STEP_SOURCE_NAMES[cur.source]?.[1] ?? cur.source : null, updatedAt: cur?.updatedAt ?? null, sources, goal, fullGoal, avg7 };
  }

  async history(userId: string, days = 7) {
    const p = await this.profiles.get(userId);
    const today = localDate(new Date(), p.timezone);
    const n = Math.max(1, Math.min(31, Math.round(days) || 7));
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      out.push({ date, steps: (await this.get(userId, date))?.steps ?? null });
    }
    return { days: out };
  }
}
