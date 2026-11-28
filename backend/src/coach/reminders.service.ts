import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { localDate } from '../common/dates';
import { Meal, PushSub } from '../common/types';
import { addDays } from '../plan/plan.service';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { ramadanView } from './coach-math';
import { ScheduleService } from '../schedule/schedule.service';
import { dueSlotReminders, toMin } from '../schedule/schedule';
import { dueMedReminders } from '../meds/meds';
import { EnergyService } from '../energy/energy.service';
import { WhoopService } from '../integrations/whoop/whoop.service';
import { WaterService } from '../water/water.service';
import { dueWaterReminder } from '../water/water';
import { ProgressService } from '../progress/progress.service';
import { activityNudges, calorieNudge, DAILY_CAP, isLocalOnIos, isUncapped, journeyLevel, KCAL_STAGES, milestoneNudge, proteinNudge, weeklyNudge } from './nudges';
import { ApnsSender, APNS_SENDER, isApnsEndpoint } from '../push/apns';

export const PUSH_SENDER = Symbol('PUSH_SENDER');
export type PushSender = (sub: PushSub, payload: string) => Promise<void>;

type Slot = 'breakfast' | 'lunch' | 'dinner';
const SLOT_RANGE: Record<Slot, [number, number]> = { breakfast: [4 * 60, 11 * 60], lunch: [11 * 60, 16 * 60], dinner: [16 * 60, 23 * 60] };
const SLOT_AR: Record<Slot, string> = { breakfast: 'فطورك', lunch: 'غداءك', dinner: 'عشاءك' };
const SLOT_NAME: Record<Slot, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء' };

const localMinutes = (iso: string | Date, tz: string) => {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};
const slotOf = (min: number): Slot | null =>
  (Object.keys(SLOT_RANGE) as Slot[]).find((s) => min >= SLOT_RANGE[s][0] && min < SLOT_RANGE[s][1]) ?? null;

export { usualMealTimes } from '../schedule/schedule';

/**
 * Decide which reminders are due right now (pure; unit-tested).
 * Meal: 45–75 min after the usual time if nothing was logged in that slot today.
 * Weight: 07:30–09:00 if no weight in the last 2 days. Quiet hours 23:00–07:00. No meal nudges while fasting.
 */
export function dueReminders(i: {
  nowMin: number;
  usual: Partial<Record<Slot, number>>;
  loggedSlotsToday: Set<Slot>;
  daysSinceWeight: number | null;
  fasting: boolean;
  prefs: { meals: boolean; weight: boolean };
  lang?: 'en' | 'ar';
}): { key: string; title: string; body: string }[] {
  const out: { key: string; title: string; body: string }[] = [];
  if (i.nowMin >= 23 * 60 || i.nowMin < 7 * 60) return out;
  if (i.prefs.meals && !i.fasting) {
    for (const s of Object.keys(i.usual) as Slot[]) {
      const t = i.usual[s]!;
      if (i.nowMin >= t + 45 && i.nowMin <= t + 75 && !i.loggedSlotsToday.has(s)) {
        out.push(
          i.lang === 'ar'
            ? { key: `meal:${s}`, title: `وقت ${SLOT_NAME[s]} 🍽️`, body: `لم تسجّل ${SLOT_AR[s]} بعد — صوّر الوجبة أو اختر من المفضلة بضغطة واحدة.` }
            : { key: `meal:${s}`, title: `${s[0].toUpperCase() + s.slice(1)} time 🍽️`, body: `You haven't logged your ${s} yet — snap it or pick a favourite in one tap.` },
        );
      }
    }
  }
  if (i.prefs.weight && i.nowMin >= 7 * 60 + 30 && i.nowMin <= 9 * 60 && (i.daysSinceWeight == null || i.daysSinceWeight >= 2)) {
    out.push(
      i.lang === 'ar'
        ? { key: 'weight', title: 'قياس الصباح ⚖️', body: 'سجّل وزنك بعد الاستيقاظ — يساعد المدرب على تعلّم حرقك الحقيقي.' }
        : { key: 'weight', title: 'Morning weigh-in ⚖️', body: 'Log your weight after waking up — it helps the coach learn your real burn.' },
    );
  }
  return out;
}

const TICK_CONCURRENCY = Number(process.env.REMINDER_CONCURRENCY) || 8;

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly send: PushSender;
  private readonly sendDisabled: boolean;
  private readonly pendingJourney = new Map<string, { target: number; level: number }>();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly config: ConfigService,
    @Optional() @Inject(PUSH_SENDER) sender?: PushSender,
    @Optional() private readonly schedule?: ScheduleService,
    @Optional() private readonly energy?: EnergyService,
    @Optional() private readonly whoop?: WhoopService,
    @Optional() private readonly water?: WaterService,
    @Optional() private readonly progress?: ProgressService,
    @Optional() @Inject(APNS_SENDER) private readonly apns?: ApnsSender,
  ) {
    this.pollMs = Math.max(5, Number(config.get('WHOOP_POLL_MINUTES') ?? 20) || 20) * 60_000;
    const pub = config.get<string>('VAPID_PUBLIC_KEY');
    const priv = config.get<string>('VAPID_PRIVATE_KEY');
    let ok = false;
    if (pub && priv) {
      // VAPID subject must be https: or mailto:; never let a bad setting crash the server.
      const candidates = [config.get<string>('VAPID_SUBJECT'), config.get<string>('PUBLIC_BASE_URL')].filter(Boolean) as string[];
      const subject = candidates.find((c) => /^(https:|mailto:)/.test(c)) ?? 'mailto:noreply@straineat.app';
      try {
        webpush.setVapidDetails(subject, pub, priv);
        ok = true;
      } catch (e: any) {
        this.log.error(`Push disabled — invalid VAPID settings: ${e?.message ?? e}`);
      }
    }
    this.enabled = ok || !!sender || !!apns?.configured;
    this.sendDisabled = !ok && !sender;
    this.send = sender ?? (async (sub, payload) => {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600 });
    });
  }

  onModuleInit() {
    if (!this.enabled || this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log.warn(`reminder tick: ${e?.message ?? e}`)), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  publicKey() {
    return { publicKey: this.config.get<string>('VAPID_PUBLIC_KEY') ?? null };
  }

  async subscribe(userId: string, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new BadRequestException('invalid subscription');
    if (!isPushServiceUrl(sub.endpoint)) throw new BadRequestException('unsupported push service');
    // at most 5 devices per user: the oldest goes
    const mine = (await this.repo.listPushSubs(userId)).filter((x) => !isApnsEndpoint(x.endpoint) && x.endpoint !== sub.endpoint);
    for (const old of mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, Math.max(0, mine.length - 4))) await this.repo.deletePushSub(old.endpoint);
    await this.repo.savePushSub({ userId, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: new Date().toISOString() });
    return { subscribed: true };
  }

  /** iOS app: register its APNs device token (stored as a push subscription "apns:<token>"). */
  async subscribeApns(userId: string, token: string) {
    const t = String(token ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{32,200}$/.test(t)) throw new BadRequestException('invalid device token');
    await this.repo.savePushSub({ userId, endpoint: `apns:${t}`, keys: { p256dh: '', auth: '' }, createdAt: new Date().toISOString() });
    return { subscribed: true, apnsConfigured: !!this.apns?.configured };
  }

  async unsubscribe(userId: string, endpoint: string) {
    const mine = (await this.repo.listPushSubs(userId)).some((s) => s.endpoint === endpoint);
    if (mine) await this.repo.deletePushSub(endpoint);
    return { subscribed: false };
  }

  async test(userId: string) {
    const lang = (await this.profiles.get(userId)).language ?? 'en';
    const n = await this.notify(userId, {
      title: 'StrainEat ✓',
      body: lang === 'ar' ? 'التنبيهات تعمل — سنذكّرك في أوقات وجباتك المعتادة.' : "Notifications work — we'll remind you around your usual meal times.",
    });
    return { sent: n };
  }

  private async notify(userId: string, msg: { title: string; body: string; key?: string }) {
    let n = 0;
    for (const s of await this.repo.listPushSubs(userId)) {
      if (isApnsEndpoint(s.endpoint)) {
        if (!this.apns?.configured || (msg.key && isLocalOnIos(msg.key))) continue; // the iOS app schedules these itself
        const r = await this.apns.send(s.endpoint.slice(5), { title: msg.title, body: msg.body, tab: tabFor(msg.key) });
        if (r === 'ok') n++;
        else if (r === 'gone') await this.repo.deletePushSub(s.endpoint);
        continue;
      }
      if (this.sendDisabled) continue;
      try {
        await this.send(s, JSON.stringify({ title: msg.title, body: msg.body, url: '/app/' }));
        n++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await this.repo.deletePushSub(s.endpoint); // expired
        else this.log.warn(`push failed: ${e?.statusCode ?? ''} ${e?.message ?? e}`);
      }
    }
    return n;
  }

  /** Runs every minute. Each reminder is sent at most once per user per day; one user's error never blocks the others. */
  private lastPurge = '';
  /** Once a day: drop per-day bookkeeping rows (sent-reminder markers, usage counters) older than 30 days. */
  private async housekeeping(now: Date) {
    const day = now.toISOString().slice(0, 10);
    if (this.lastPurge === day || now.getUTCHours() < 1) return;
    this.lastPurge = day;
    try {
      const n = await this.repo.purgeCache(['reminder:', 'usage:'], new Date(now.getTime() - 30 * 86400000).toISOString());
      if (n) this.log.log(`housekeeping: removed ${n} old cache rows`);
    } catch (e: any) { this.log.warn(`housekeeping: ${e?.message ?? e}`); }
  }

  async tick(now = new Date()) {
    if (this.busy) return { users: 0, sent: 0, skipped: true }; // a slow tick (WHOOP sync) must not overlap the next
    this.busy = true;
    try {
      const users = [...new Set((await this.repo.listPushSubs()).map((s) => s.userId))];
      let sent = 0;
      // a few users at a time so one minute's work keeps up as users grow
      const queue = [...users];
      const worker = async () => {
        for (let u = queue.shift(); u !== undefined; u = queue.shift()) {
          try { sent += await this.tickUser(u, now); } catch (e: any) { this.log.warn(`reminders for ${u}: ${e?.message ?? e}`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(TICK_CONCURRENCY, queue.length) }, worker));
      await this.housekeeping(now);
      if (sent) this.log.log(`reminders sent: ${sent}`);
      return { users: users.length, sent };
    } finally {
      this.busy = false;
    }
  }

  /** Keep WHOOP data fresh (every WHOOP_POLL_MINUTES, 05:00–23:00) so morning / after-workout notes go out without opening the app. */
  private async pollWhoop(userId: string, today: string, nowMin: number, now: Date) {
    if (!this.whoop || nowMin < 5 * 60 || nowMin >= 23 * 60) return;
    const last = await this.repo.getCache(userId, 'whoop-poll');
    if (last && now.getTime() - Date.parse(last.createdAt) < this.pollMs) return;
    if (!(await this.repo.getTokens(userId, 'whoop'))) return;
    await this.repo.setCache({ userId, key: 'whoop-poll', payload: {}, createdAt: now.toISOString() });
    try {
      await this.whoop.sync(userId, addDays(today, -1), today);
    } catch (e: any) {
      this.log.warn(`WHOOP poll for ${userId}: ${e?.message ?? e}`);
    }
  }

  /** Morning plan (05:00–12:00, once recovery is in) and a note after each notable workout (within 3 h). */
  private async insightPushes(userId: string, today: string, nowMin: number, now: Date, lang: string) {
    if (!this.energy) return [];
    const doneKey = (k: string) => this.repo.getCache(userId, `reminder:${today}:${k}`);
    const well = (await this.repo.getCache(userId, `whoop-day:${today}`))?.payload as { recovery?: number | null } | undefined;
    const wantMorning = nowMin >= 5 * 60 && nowMin < 12 * 60 && well?.recovery != null && !(await doneKey('am'));
    if (!wantMorning) return [];
    const b = await this.energy.balance(userId, today, now);
    const out: { key: string; title: string; body: string }[] = [];
    for (const c of b.cards ?? []) {
      const title = lang === 'ar' ? c.title_ar : c.title_en;
      const body = (lang === 'ar' ? c.lines_ar : c.lines_en).slice(0, 2).join(' ');
      if (c.kind === 'morning') out.push({ key: 'am', title, body });
    }
    return out;
  }

  /** Activity, calories, protein, weekly summary, goal milestones (each can be switched off in Settings → Notifications). */
  private async essentials(userId: string, today: string, nowMin: number, now: Date, lang: string, fasting: boolean, prefs: Record<string, boolean | undefined>) {
    const out: { key: string; title: string; body: string }[] = [];
    const on = (k: string) => prefs[k] !== false;
    if (this.energy && (on('activity') || on('calories') || on('protein'))) {
      const b: any = await this.energy.balance(userId, today, now);
      const remaining = b.targetIntakeKcal > 0 ? Math.round(b.remainingKcal) : null;
      if (on('activity')) {
        const raw = await this.repo.listWorkouts(userId, today, today);
        const named = new Map<string, any>((b.activity?.workouts ?? []).map((w: any) => [w.id, w]));
        const list = raw.map((w) => ({ ...w, sportAr: named.get(w.id)?.sportAr, sportEn: named.get(w.id)?.sportEn }));
        for (const n of activityNudges({ now, workouts: list, remainingKcal: remaining, fasting, lang })) {
          const card = (b.cards ?? []).find((c: any) => c.id === n.key);
          const extra = card ? (lang === 'ar' ? card.lines_ar : card.lines_en)?.[0] : null;
          out.push(extra ? { ...n, body: `${n.body} ${extra}` } : n);
        }
      }
      if (on('calories')) {
        const c = calorieNudge({ eatenKcal: b.intake?.calories ?? 0, targetKcal: b.targetIntakeKcal, goal: b.goal, fasting, lang });
        if (c) out.push(c);
      }
      if (on('protein')) {
        const meals = (b.meals ?? []).filter((m: any) => m.status === 'confirmed').length;
        const p = proteinNudge({ nowMin, proteinG: b.intake?.protein_g ?? 0, targetG: b.macroTargets?.protein_g ?? 0, mealsToday: meals, fasting, lang });
        if (p) out.push(p);
      }
    }
    if (this.progress && (on('weekly') || on('milestones'))) {
      const tz = (await this.profiles.get(userId)).timezone;
      const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now));
      const wantWeek = on('weekly') && weekday === 0 && nowMin >= 20 * 60 && nowMin <= 21 * 60 + 30;
      // journey milestones are checked at most every 30 min
      const jKey = 'nudge-journey';
      const jPrev = (await this.repo.getCache(userId, jKey))?.payload as { target?: number; level?: number; at?: string } | undefined;
      const wantJourney = on('milestones') && (!jPrev?.at || now.getTime() - Date.parse(jPrev.at) >= 30 * 60000);
      if (wantWeek || wantJourney) {
        const sum: any = await this.progress.summary(userId);
        if (wantWeek) {
          const w = weeklyNudge({ weekday, nowMin, week: sum.week, lang });
          if (w) out.push(w);
        }
        if (wantJourney) {
          const j = sum.journey;
          if (j?.targetKg != null && j.frac != null) {
            const level = journeyLevel(j.frac);
            const prev = jPrev?.target === j.targetKg && jPrev?.level != null ? jPrev.level : null;
            const m = milestoneNudge({ level, prevLevel: prev, targetKg: j.targetKg, currentKg: j.currentKg, lang });
            if (m) {
              // the new level is saved only once the milestone is delivered (see tickUser)
              out.push(m);
              this.pendingJourney.set(userId, { target: j.targetKg, level });
              await this.repo.setCache({ userId, key: jKey, payload: { target: j.targetKg, level: prev ?? 0, at: now.toISOString() }, createdAt: now.toISOString() });
            } else await this.repo.setCache({ userId, key: jKey, payload: { target: j.targetKg, level: Math.max(level, prev ?? 0), at: now.toISOString() }, createdAt: now.toISOString() });
          } else await this.repo.setCache({ userId, key: jKey, payload: { at: now.toISOString() }, createdAt: now.toISOString() });
        }
      }
    }
    return out;
  }

  private async tickUser(userId: string, now: Date) {
    let sent = 0;
    {
      const p = await this.profiles.get(userId);
      const tz = p.timezone;
      const today = localDate(now, tz);
      const w = await this.repo.listWeights(userId, addDays(today, -30), today);
      const lastW = w.length ? w[w.length - 1].date : null;
      const prefs = p.reminders ?? { meals: true, weight: true };
      const lang = p.language ?? 'en';
      const fasting = ramadanView(p.ramadan, now, tz, 2000).fasting;
      const nowMin = localMinutes(now, tz);
      await this.pollWhoop(userId, today, nowMin, now);
      // weight reminder (meal reminders now follow the eating schedule below)
      const due = dueReminders({
        nowMin,
        usual: {},
        loggedSlotsToday: new Set(),
        daysSinceWeight: lastW ? Math.round((Date.parse(today) - Date.parse(lastW)) / 86400000) : null,
        fasting,
        prefs: { meals: false, weight: prefs.weight },
        lang,
      });
      due.push(...dueMedReminders(p.medReminders ?? [], nowMin, lang === 'ar' ? 'ar' : 'en'));
      if (prefs.meals && this.schedule) {
        const day = await this.schedule.day(userId, undefined, now);
        due.push(...dueSlotReminders(day.slots, toMin(`${Math.floor(nowMin / 60)}:${nowMin % 60}`), lang, { fasting }));
      }
      due.push(...(await this.insightPushes(userId, today, nowMin, now, lang)));
      if (prefs.water !== false && this.water && nowMin >= 7 * 60 && nowMin < 23 * 60) {
        const rv = ramadanView(p.ramadan, now, tz, 2000);
        const wd = await this.water.day(userId, today, now);
        const r = dueWaterReminder({ nowMin, intakeMl: wd.intakeMl, expectedMl: wd.expectedByNowMl, targetMl: wd.targetMl, fasting, fastDay: rv.active, iftarMin: rv.active ? toMin(rv.iftarTime) : null, lang });
        if (r) due.push(r);
      }
      if (nowMin >= 7 * 60 && nowMin < 23 * 60) due.push(...(await this.essentials(userId, today, nowMin, now, lang, fasting, prefs as Record<string, boolean | undefined>)));
      const capKey = `reminder:${today}:_count`;
      let count = Number(((await this.repo.getCache(userId, capKey))?.payload as { n?: number } | undefined)?.n ?? 0);
      for (const r of due) {
        const key = `reminder:${today}:${r.key}`;
        if (await this.repo.getCache(userId, key)) continue;
        const capped = !isUncapped(r.key);
        if (capped && count >= DAILY_CAP) continue;
        await this.repo.setCache({ userId, key, payload: { at: now.toISOString() }, createdAt: now.toISOString() });
        // the highest calorie stage replaces the lower ones
        if (r.key.startsWith('kcal:'))
          for (const k of KCAL_STAGES.slice(0, KCAL_STAGES.indexOf(r.key as any)))
            await this.repo.setCache({ userId, key: `reminder:${today}:${k}`, payload: { at: now.toISOString(), skipped: true }, createdAt: now.toISOString() });
        const delivered = await this.notify(userId, r);
        sent += delivered;
        // only alerts that actually reached a device count toward the daily cap (iOS keeps meal/water/med reminders local)
        if (capped && delivered > 0) {
          count++;
          await this.repo.setCache({ userId, key: capKey, payload: { n: count }, createdAt: now.toISOString() });
        }
        if (r.key.startsWith('goal:') && delivered > 0) {
          const j = this.pendingJourney.get(userId);
          if (j) await this.repo.setCache({ userId, key: 'nudge-journey', payload: { ...j, at: now.toISOString() }, createdAt: now.toISOString() });
        }
      }
    }
    return sent;
  }
}

/** Web-push endpoints must belong to a real browser push service (the server POSTs to them, so no arbitrary hosts). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function isPushServiceUrl(endpoint: string, extra = process.env.PUSH_EXTRA_HOSTS ?? (process.env.NODE_ENV === 'test' ? 'push.example' : '')): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((r) => r.test(host)) || extra.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

/** Which app screen an alert opens when tapped. */
export function tabFor(key?: string): string {
  if (!key) return 'today';
  if (key === 'week' || key.startsWith('goal:') || key === 'weight') return 'progress';
  return 'today';
}
