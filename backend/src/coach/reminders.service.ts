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

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly enabled: boolean;
  private readonly send: PushSender;

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly config: ConfigService,
    @Optional() @Inject(PUSH_SENDER) sender?: PushSender,
    @Optional() private readonly schedule?: ScheduleService,
  ) {
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
    this.enabled = ok || !!sender;
    this.send = sender ?? (async (sub, payload) => {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600 });
    });
  }

  onModuleInit() {
    if (!this.enabled || this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log.warn(`reminder tick: ${e?.message ?? e}`)), 5 * 60_000);
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
    await this.repo.savePushSub({ userId, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: new Date().toISOString() });
    return { subscribed: true };
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

  private async notify(userId: string, msg: { title: string; body: string }) {
    let n = 0;
    for (const s of await this.repo.listPushSubs(userId)) {
      try {
        await this.send(s, JSON.stringify({ ...msg, url: '/app/' }));
        n++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await this.repo.deletePushSub(s.endpoint); // expired
        else this.log.warn(`push failed: ${e?.statusCode ?? ''} ${e?.message ?? e}`);
      }
    }
    return n;
  }

  /** Runs every 5 minutes. Each reminder is sent at most once per user per day. */
  async tick(now = new Date()) {
    const users = [...new Set((await this.repo.listPushSubs()).map((s) => s.userId))];
    let sent = 0;
    for (const userId of users) {
      const p = await this.profiles.get(userId);
      const tz = p.timezone;
      const today = localDate(now, tz);
      const w = await this.repo.listWeights(userId, addDays(today, -30), today);
      const lastW = w.length ? w[w.length - 1].date : null;
      const prefs = p.reminders ?? { meals: true, weight: true };
      const lang = p.language ?? 'en';
      const fasting = ramadanView(p.ramadan, now, tz, 2000).fasting;
      const nowMin = localMinutes(now, tz);
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
      if (prefs.meals && this.schedule) {
        const day = await this.schedule.day(userId, undefined, now);
        due.push(...dueSlotReminders(day.slots, toMin(`${Math.floor(nowMin / 60)}:${nowMin % 60}`), lang, { fasting }));
      }
      due.push(...dueMedReminders(p.medReminders ?? [], nowMin, lang === 'ar' ? 'ar' : 'en'));
      for (const r of due) {
        const key = `reminder:${today}:${r.key}`;
        if (await this.repo.getCache(userId, key)) continue;
        await this.repo.setCache({ userId, key, payload: { at: now.toISOString() }, createdAt: now.toISOString() });
        sent += await this.notify(userId, r);
      }
    }
    return { users: users.length, sent };
  }
}
