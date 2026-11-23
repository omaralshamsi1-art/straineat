import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isIsoDate, localDate } from '../common/dates';
import { WaterEntry } from '../common/types';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { kindOf } from '../schedule/schedule';
import { localMinuteOfDay } from '../insights/insights';
import { ramadanView } from '../coach/coach-math';
import { addDays } from '../plan/plan.service';
import { DAILY_WARN_ML, drinkMl, expectedShare, HOURLY_WARN_ML, maxHourMl, waterTarget } from './water';

type Note = { code: string; level: 'info' | 'warn'; text_ar: string; text_en: string };

@Injectable()
export class WaterService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
  ) {}

  async add(userId: string, body: { ml?: unknown; date?: unknown; at?: unknown }) {
    const ml = Math.round(Number(body?.ml));
    if (!Number.isFinite(ml) || ml < 10 || ml > 3000) throw new BadRequestException('ml must be between 10 and 3000');
    const profile = await this.profiles.get(userId);
    const at = typeof body?.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : new Date().toISOString();
    const date = typeof body?.date === 'string' ? body.date : localDate(new Date(at), profile.timezone);
    if (!isIsoDate(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    const e: WaterEntry = { userId, id: `w:${randomUUID()}`, date, ml, source: 'manual', at };
    await this.repo.upsertWater(e);
    return this.day(userId, date);
  }

  async remove(userId: string, id: string) {
    const all = await this.repo.listWater(userId, '2000-01-01', '2999-12-31');
    const e = all.find((x) => x.id === id);
    if (!e || e.source !== 'manual') throw new BadRequestException('entry not found');
    await this.repo.deleteWater(userId, id);
    return this.day(userId, e.date);
  }

  /** Apple Health daily totals (other apps' water, excluding what StrainEat itself wrote). */
  async ingest(userId: string, samples: { date?: unknown; ml?: unknown }[]) {
    if (!Array.isArray(samples) || !samples.length) throw new BadRequestException('samples[] required');
    let saved = 0;
    for (const s of samples.slice(0, 31)) {
      const date = String(s?.date ?? '');
      const ml = Math.round(Number(s?.ml));
      if (!isIsoDate(date) || !Number.isFinite(ml) || ml < 0 || ml > 15000) throw new BadRequestException('each sample needs date and ml');
      if (ml === 0) { await this.repo.deleteWater(userId, `apple_health:${date}`); continue; }
      await this.repo.upsertWater({ userId, id: `apple_health:${date}`, date, ml, source: 'apple_health', at: `${date}T12:00:00.000Z` });
      saved++;
    }
    return { saved };
  }

  async day(userId: string, date?: string, now = new Date()) {
    const profile = await this.profiles.get(userId);
    const today = localDate(now, profile.timezone);
    const d = date ?? today;
    if (!isIsoDate(d)) throw new BadRequestException('date must be YYYY-MM-DD');
    const [entries, meals, workouts] = await Promise.all([
      this.repo.listWater(userId, d, d),
      this.repo.listMeals(userId, d),
      this.repo.listWorkouts(userId, d, d),
    ]);
    const workoutMin = dedupeMinutes(workouts);
    const t = waterTarget(profile, workoutMin);
    const drinks = meals
      .filter((m) => m.status === 'confirmed' && kindOf(m) === 'drink')
      .map((m) => ({ id: m.id, name: m.final.meal_name, name_ar: m.final.meal_name_ar, ml: drinkMl(m.final.items), at: m.eatenAt }));
    const manualMl = entries.filter((e) => e.source === 'manual').reduce((a, e) => a + e.ml, 0);
    const healthMl = entries.filter((e) => e.source === 'apple_health').reduce((a, e) => a + e.ml, 0);
    const drinksMl = drinks.reduce((a, x) => a + x.ml, 0);
    const intakeMl = manualMl + healthMl + drinksMl;
    const isToday = d === today;
    const ram = isToday ? ramadanView(profile.ramadan, now, profile.timezone, 0) : null;
    const nowMin = localMinuteOfDay(now, profile.timezone);
    // fasting day: drinking happens between iftar and the next suhoor; none expected while fasting
    const share = ram?.active ? fastShare(nowMin, ram.suhoorTime, ram.iftarTime) : expectedShare(nowMin);
    const expectedByNowMl = t.targetMl == null ? null : isToday ? Math.round((t.targetMl * share) / 50) * 50 : t.targetMl;

    const notes: Note[] = [];
    if (t.supervised) notes.push({ code: 'supervised', level: 'info', text_ar: 'مع أمراض الكلى أو القلب قد يحدد طبيبك كمية السوائل، فنعرض المتابعة فقط بدون هدف. اتبع تعليمات طبيبك.', text_en: 'With kidney or heart conditions your doctor may limit fluids, so we only track — no target. Follow your doctor’s advice.' });
    if (t.workoutMl) notes.push({ code: 'workout', level: 'info', text_ar: `+${t.workoutMl} مل لتمرين اليوم (${workoutMin} دقيقة).`, text_en: `+${t.workoutMl} ml for today's training (${workoutMin} min).` });
    if (t.heatMl) notes.push({ code: 'heat', level: 'info', text_ar: `+${t.heatMl} مل للحر والعمل أو التمرين في الخارج.`, text_en: `+${t.heatMl} ml for heat and outdoor work or training.` });
    if (ram?.active) notes.push({ code: 'ramadan', level: 'info', text_ar: `${ram.kind === 'ramadan' ? 'في رمضان' : 'يوم صيامك'} وزّع الماء بين الإفطار (${ram.iftarTime}) والسحور (${ram.suhoorTime}) على دفعات، بدل كمية كبيرة مرة وحدة.`, text_en: `${ram.kind === 'ramadan' ? 'In Ramadan' : 'On your fasting day'} spread your water between iftar (${ram.iftarTime}) and suhoor (${ram.suhoorTime}) in small rounds instead of a lot at once.` });
    const manualHour = maxHourMl(entries.filter((e) => e.source === 'manual'));
    if (manualHour > HOURLY_WARN_ML) notes.push({ code: 'too_fast', level: 'warn', text_ar: `سجّلت ${manualHour} مل خلال ساعة. شرب كمية كبيرة بسرعة ممكن يخفّض الصوديوم في الدم — وزّعها على اليوم.`, text_en: `You logged ${manualHour} ml within an hour. Drinking a lot fast can lower blood sodium — spread it through the day.` });
    if (intakeMl > DAILY_WARN_ML) notes.push({ code: 'too_much', level: 'warn', text_ar: 'كمية السوائل اليوم عالية جداً. إذا ما كنت في حر شديد أو تمرين طويل، لا تزيد — والإفراط قد يسبب نقص الصوديوم.', text_en: 'Fluids today are very high. Unless it’s extreme heat or long training, don’t push more — too much can cause low sodium.' });

    return {
      date: d,
      targetMl: t.targetMl,
      baseMl: t.baseMl,
      workoutMl: t.workoutMl,
      heatMl: t.heatMl,
      supervised: t.supervised,
      intakeMl,
      manualMl,
      healthMl,
      drinksMl,
      expectedByNowMl,
      remainingMl: t.targetMl == null ? null : Math.max(0, t.targetMl - intakeMl),
      entries: entries.filter((e) => e.source === 'manual').map(({ userId: _u, ...e }) => e),
      drinks,
      notes,
    };
  }

  async history(userId: string, days = 7) {
    const profile = await this.profiles.get(userId);
    const n = Math.max(1, Math.min(31, Math.round(days) || 7));
    const today = localDate(new Date(), profile.timezone);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = await this.day(userId, addDays(today, -i));
      out.push({ date: d.date, intakeMl: d.intakeMl, targetMl: d.targetMl });
    }
    return { days: out };
  }
}

/** minutes of training, counting overlapping sessions from two devices once */
function dedupeMinutes(ws: { start: string; end: string; durationMin: number }[]): number {
  const xs = ws.map((w) => [Date.parse(w.start), Date.parse(w.end)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, curS = -1, curE = -1;
  for (const [s, e] of xs) {
    if (s > curE) { if (curE > curS) total += curE - curS; curS = s; curE = e; }
    else curE = Math.max(curE, e);
  }
  if (curE > curS) total += curE - curS;
  return Math.round(total / 60000);
}

/** share of the water target expected by now on a fasting day (iftar → next suhoor window) */
export function fastShare(nowMin: number, suhoor: string, iftar: string): number {
  const m = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const s = m(suhoor), i = m(iftar);
  const span = s + 1440 - i;
  if (nowMin >= s && nowMin < i) return 0;
  const since = nowMin >= i ? nowMin - i : nowMin + 1440 - i;
  return Math.max(0, Math.min(1, since / span));
}
