import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { dayBoundsUtc, localDate } from '../../common/dates';
import { FETCH, FetchFn } from '../../common/fetch';
import { OAuthTokens } from '../../common/types';
import { EnergyService } from '../../energy/energy.service';
import { ProfileService } from '../../profile/profile.service';
import { REPOSITORY, Repository } from '../../storage/repository';

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE = 'https://api.prod.whoop.com/developer';
const SCOPES = 'offline read:cycles read:workout read:profile read:body_measurement read:recovery read:sleep';
const KJ_PER_KCAL = 4.184;
/** short, non-reversible user tag for logs */
const short = (userId: string) => createHmac('sha256', 'log').update(userId).digest('hex').slice(0, 6);


interface WhoopCycle {
  id: number | string;
  start: string;
  end: string | null;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
}

@Injectable()
export class WhoopService {
  private readonly log = new Logger(WhoopService.name);
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly config: ConfigService,
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly energy: EnergyService,
    private readonly profiles: ProfileService,
    @Optional() @Inject(FETCH) fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  // ---------- OAuth ----------
  authorizeUrl(userId: string, target: 'app' | 'web' = 'app'): string {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: this.req('WHOOP_CLIENT_ID'),
      redirect_uri: this.req('WHOOP_REDIRECT_URI'),
      scope: SCOPES,
      state: this.signState(userId, target),
    });
    return `${AUTH_URL}?${p}`;
  }

  /** Where the browser should go after OAuth, decoded from a state value (falls back to the app). */
  callbackTarget(state: string): 'app' | 'web' {
    try {
      return JSON.parse(Buffer.from((state ?? '').split('.')[0], 'base64url').toString()).r === 'web' ? 'web' : 'app';
    } catch {
      return 'app';
    }
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const userId = this.verifyState(state);
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.req('WHOOP_REDIRECT_URI'),
    });
    await this.repo.saveTokens(this.toTokens(userId, tokens));
    // Which WHOOP account was linked (shown in Settings, so a wrong login is obvious), then a first sync.
    await this.rememberAccount(userId).catch((e) => this.log.warn(`WHOOP profile skipped: ${e?.message ?? e}`));
    try {
      const p = await this.profiles.get(userId);
      const today = localDate(new Date(), p.timezone);
      await this.sync(userId, addDaysIso(today, -1), today);
    } catch (e: any) {
      this.log.warn(`WHOOP first sync failed for ${short(userId)}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
    return userId;
  }

  /** Name + masked email of the linked WHOOP account (read:profile). */
  private async rememberAccount(userId: string) {
    const b = await this.api(userId, '/v2/user/profile/basic');
    const email = typeof b?.email === 'string' ? b.email : '';
    const [local, domain] = email.split('@');
    const payload = {
      whoopUserId: b?.user_id ?? null,
      name: [b?.first_name, b?.last_name ? `${String(b.last_name).charAt(0)}.` : ''].filter(Boolean).join(' ') || null,
      email: local && domain ? `${local.charAt(0)}***@${domain}` : null,
    };
    await this.repo.setCache({ userId, key: 'whoop-account', payload, createdAt: new Date().toISOString() });
    return payload;
  }

  async disconnect(userId: string) {
    await this.repo.deleteTokens(userId, 'whoop');
    return { connected: false };
  }

  async status(userId: string) {
    const t = await this.repo.getTokens(userId, 'whoop');
    const account = t ? (await this.repo.getCache(userId, 'whoop-account'))?.payload ?? null : null;
    const lastSync = t ? (await this.repo.getCache(userId, 'whoop-last-sync'))?.payload ?? null : null;
    return { connected: !!t, expiresAt: t?.expiresAt ?? null, account, lastSync };
  }

  // ---------- Sync ----------
  /** Pulls WHOOP cycles for [from, to] (local dates) and stores daily energy (kJ → kcal). */
  async sync(userId: string, from: string, to: string) {
    const profile = await this.profiles.get(userId);
    const start = dayBoundsUtc(from, profile.timezone).start;
    const end = dayBoundsUtc(to, profile.timezone).end;
    const cycles = await this.fetchCycles(userId, start, end);

    // A WHOOP cycle runs sleep-onset → next sleep-onset; attribute it to the local date of its midpoint.
    const byDate = new Map<string, number>();
    const strainByDate = new Map<string, number>();
    for (const c of cycles) {
      if (c.score_state !== 'SCORED' || !c.score) continue;
      const s = new Date(c.start).getTime();
      const e = c.end ? new Date(c.end).getTime() : Date.now();
      const date = localDate(new Date((s + e) / 2), profile.timezone);
      if (date < from || date > to) continue;
      byDate.set(date, Math.max(byDate.get(date) ?? 0, c.score.kilojoule / KJ_PER_KCAL));
      if (c.score.strain != null) strainByDate.set(date, Math.round(c.score.strain * 10) / 10);
    }
    // Recovery + sleep (needs read:recovery / read:sleep — older connections must reconnect once)
    let wellness = 0;
    try {
      wellness = await this.syncWellness(userId, start, end, profile.timezone, from, to, strainByDate);
      await this.repo.setCache({ userId, key: 'whoop-wellness-scope', payload: { ok: true }, createdAt: new Date().toISOString() });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      this.log.warn(`WHOOP recovery/sleep skipped: ${msg.slice(0, 200)}`);
      if (/WHOOP API (401|403)/.test(msg)) {
        await this.repo.setCache({ userId, key: 'whoop-wellness-scope', payload: { ok: false }, createdAt: new Date().toISOString() });
      }
    }
    // Workouts (activity type, strain, HR, zones)
    let workouts = 0;
    try {
      workouts = await this.syncWorkouts(userId, start, end, profile.timezone);
    } catch (e: any) {
      this.log.warn(`WHOOP workouts skipped: ${e?.message ?? e}`);
    }

    // Body weight from WHOOP's body measurements (kept as its own source; manual entries win).
    let weightKg: number | null = null;
    try {
      const body = await this.api(userId, '/v2/user/measurement/body');
      if (body?.weight_kilogram > 20) {
        weightKg = Math.round(body.weight_kilogram * 10) / 10;
        await this.repo.upsertWeight({
          userId,
          date: localDate(new Date(), profile.timezone),
          kg: weightKg,
          source: 'whoop',
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      this.log.warn(`WHOOP body measurement skipped: ${e?.message ?? e}`);
    }
    if (byDate.size) {
      await this.energy.ingest(
        userId,
        [...byDate].map(([date, kcal]) => ({ date, source: 'whoop' as const, totalKcal: Math.round(kcal) })),
      );
    }
    // What came back — kept for Settings ("last sync") and the logs, so an empty WHOOP account is easy to spot.
    const scored = cycles.filter((c) => c.score_state === 'SCORED').length;
    const summary = { at: new Date().toISOString(), from, to, cycles: cycles.length, scored, days: byDate.size, wellness, workouts };
    await this.repo.setCache({ userId, key: 'whoop-last-sync', payload: summary, createdAt: summary.at });
    this.log.log(`WHOOP sync ${short(userId)} ${from}..${to}: cycles ${cycles.length} (scored ${scored}), days ${byDate.size}, wellness ${wellness}, workouts ${workouts}`);
    if (!(await this.repo.getCache(userId, 'whoop-account'))) await this.rememberAccount(userId).catch(() => undefined);
    return { cycles: cycles.length, scored, workouts, wellness, weightKg, days: Object.fromEntries([...byDate].map(([d, k]) => [d, Math.round(k)])) };
  }

  /** Recovery (HRV, resting HR, SpO2, skin temp) + main sleep per wake-up day, stored as `whoop-day:<date>`. */
  private async syncWellness(userId: string, start: Date, end: Date, tz: string, from: string, to: string, strain: Map<string, number>): Promise<number> {
    // fetch a bit earlier so last night's sleep (started before `from`) is included
    const s0 = new Date(start.getTime() - 18 * 3600 * 1000);
    const sleeps = await this.collect(userId, '/v2/activity/sleep', s0, end);
    const recs = await this.collect(userId, '/v2/recovery', s0, end);
    const days = new Map<string, Record<string, unknown>>();
    const day = (d: string) => days.get(d) ?? (days.set(d, {}), days.get(d)!);
    const min = (ms: unknown) => (typeof ms === 'number' ? Math.round(ms / 60000) : null);
    const sleepDate = new Map<string, string>();
    for (const sl of sleeps) {
      if (!sl?.end || sl.nap || sl.score_state !== 'SCORED' || !sl.score) continue;
      const d = localDate(new Date(sl.end), tz);
      sleepDate.set(String(sl.id), d);
      const st = sl.score.stage_summary ?? {};
      const asleep = (st.total_light_sleep_time_milli ?? 0) + (st.total_slow_wave_sleep_time_milli ?? 0) + (st.total_rem_sleep_time_milli ?? 0);
      const need = sl.score.sleep_needed ?? {};
      const needMs = (need.baseline_milli ?? 0) + (need.need_from_sleep_debt_milli ?? 0) + (need.need_from_recent_strain_milli ?? 0) + (need.need_from_recent_nap_milli ?? 0);
      const prev = day(d);
      if ((prev.sleepMin as number | undefined) != null && (prev.sleepMin as number) >= Math.round(asleep / 60000)) continue; // keep the longest
      Object.assign(prev, {
        sleepStart: sl.start, sleepEnd: sl.end,
        sleepMin: Math.round(asleep / 60000), inBedMin: min(st.total_in_bed_time_milli), awakeMin: min(st.total_awake_time_milli),
        lightMin: min(st.total_light_sleep_time_milli), deepMin: min(st.total_slow_wave_sleep_time_milli), remMin: min(st.total_rem_sleep_time_milli),
        sleepNeededMin: needMs ? Math.round(needMs / 60000) : null,
        sleepPerformance: sl.score.sleep_performance_percentage ?? null, sleepEfficiency: sl.score.sleep_efficiency_percentage != null ? Math.round(sl.score.sleep_efficiency_percentage) : null,
        sleepConsistency: sl.score.sleep_consistency_percentage ?? null, respiratoryRate: sl.score.respiratory_rate != null ? Math.round(sl.score.respiratory_rate * 10) / 10 : null,
        disturbances: st.disturbance_count ?? null,
      });
    }
    for (const r of recs) {
      if (r?.score_state !== 'SCORED' || !r.score) continue;
      const d = sleepDate.get(String(r.sleep_id)) ?? localDate(new Date(r.created_at ?? r.updated_at ?? Date.now()), tz);
      Object.assign(day(d), {
        recovery: r.score.recovery_score ?? null,
        restingHr: r.score.resting_heart_rate ?? null,
        hrv: r.score.hrv_rmssd_milli != null ? Math.round(r.score.hrv_rmssd_milli) : null,
        spo2: r.score.spo2_percentage != null ? Math.round(r.score.spo2_percentage * 10) / 10 : null,
        skinTemp: r.score.skin_temp_celsius != null ? Math.round(r.score.skin_temp_celsius * 10) / 10 : null,
        calibrating: !!r.score.user_calibrating,
      });
    }
    for (const [d, v] of strain) day(d).strain = v;
    let n = 0;
    for (const [d, v] of days) {
      if (d < addDaysIso(from, -1) || d > to) continue;
      const key = `whoop-day:${d}`;
      const old = ((await this.repo.getCache(userId, key))?.payload as Record<string, unknown>) ?? {};
      await this.repo.setCache({ userId, key, payload: { ...old, ...v, date: d }, createdAt: new Date().toISOString() });
      n++;
    }
    return n;
  }

  private async collect(userId: string, path: string, start: Date, end: Date): Promise<any[]> {
    const out: any[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 6; page++) {
      const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '25' });
      if (nextToken) q.set('nextToken', nextToken);
      const body = await this.api(userId, `${path}?${q}`);
      out.push(...(body.records ?? []));
      nextToken = body.next_token ?? undefined;
      if (!nextToken) break;
    }
    return out;
  }

  /** Recovery / sleep / strain for each of the last `days` local days (from the sync cache). */
  async wellness(userId: string, date: string, days = 7) {
    const out: Record<string, unknown>[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDaysIso(date, -i);
      const hit = await this.repo.getCache(userId, `whoop-day:${d}`);
      out.push({ date: d, ...((hit?.payload as object) ?? {}) });
    }
    const scope = (await this.repo.getCache(userId, 'whoop-wellness-scope'))?.payload as { ok?: boolean } | undefined;
    const connected = !!(await this.repo.getTokens(userId, 'whoop'));
    return { connected, needsReconnect: connected && scope?.ok === false, today: out[out.length - 1], days: out };
  }

  private async syncWorkouts(userId: string, start: Date, end: Date, tz: string): Promise<number> {
    let nextToken: string | undefined;
    let n = 0;
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '25' });
      if (nextToken) q.set('nextToken', nextToken);
      const body = await this.api(userId, `/v2/activity/workout?${q}`);
      for (const w of body.records ?? []) {
        if (!w?.id || !w.start || !w.end) continue;
        const sc = w.score_state === 'SCORED' ? w.score ?? {} : {};
        const z = sc.zone_durations ?? null;
        const zones = z
          ? ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli'].map(
              (k) => Math.round(((z[k] ?? 0) / 60000) * 10) / 10,
            )
          : null;
        const s0 = new Date(w.start), e0 = new Date(w.end);
        await this.repo.upsertWorkout({
          userId,
          id: `whoop:${w.id}`,
          source: 'whoop',
          sport: w.sport_name ?? 'activity',
          start: s0.toISOString(),
          end: e0.toISOString(),
          date: localDate(s0, tz),
          durationMin: Math.round((e0.getTime() - s0.getTime()) / 6000) / 10,
          kcal: sc.kilojoule != null ? Math.round(sc.kilojoule / KJ_PER_KCAL) : null,
          strain: sc.strain != null ? Math.round(sc.strain * 10) / 10 : null,
          avgHr: sc.average_heart_rate ?? null,
          maxHr: sc.max_heart_rate ?? null,
          distanceM: sc.distance_meter != null ? Math.round(sc.distance_meter) : null,
          zonesMin: zones,
          updatedAt: new Date().toISOString(),
        });
        n++;
      }
      nextToken = body.next_token ?? undefined;
      if (!nextToken) break;
    }
    return n;
  }

  private async fetchCycles(userId: string, start: Date, end: Date): Promise<WhoopCycle[]> {
    const out: WhoopCycle[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '25' });
      if (nextToken) q.set('nextToken', nextToken);
      const body = await this.api(userId, `/v2/cycle?${q}`);
      out.push(...(body.records ?? []));
      nextToken = body.next_token ?? undefined;
      if (!nextToken) break;
    }
    return out;
  }

  private async api(userId: string, path: string, retried = false): Promise<any> {
    const token = await this.validAccessToken(userId);
    const res = await this.fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && !retried) {
      await this.refresh(userId);
      return this.api(userId, path, true);
    }
    if (!res.ok) throw new BadRequestException(`WHOOP API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async validAccessToken(userId: string): Promise<string> {
    const t = await this.repo.getTokens(userId, 'whoop');
    if (!t) throw new ConflictException('WHOOP not connected — connect it in Settings');
    if (new Date(t.expiresAt).getTime() - Date.now() < 60_000) return (await this.refresh(userId)).accessToken;
    return t.accessToken;
  }

  /** One refresh per user at a time: the app, the background poll and a manual sync can overlap, and WHOOP rotates refresh tokens. */
  private readonly refreshing = new Map<string, Promise<OAuthTokens>>();
  private refresh(userId: string): Promise<OAuthTokens> {
    const running = this.refreshing.get(userId);
    if (running) return running;
    const p = (async () => {
      const t = await this.repo.getTokens(userId, 'whoop');
      if (!t?.refreshToken) throw new ConflictException('WHOOP session expired — reconnect WHOOP in Settings');
      try {
        const fresh = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, scope: 'offline' });
        const saved = this.toTokens(userId, fresh, t.refreshToken);
        await this.repo.saveTokens(saved);
        return saved;
      } catch (e: any) {
        this.log.warn(`WHOOP token refresh failed for ${short(userId)}: ${String(e?.message ?? e).slice(0, 160)}`);
        throw e;
      }
    })().finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, p);
    return p;
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.req('WHOOP_CLIENT_ID'),
        client_secret: this.req('WHOOP_CLIENT_SECRET'),
      }),
    });
    if (!res.ok) throw new ConflictException(`WHOOP token error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)} — reconnect WHOOP in Settings`);
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  }

  private toTokens(
    userId: string,
    r: { access_token: string; refresh_token?: string; expires_in: number; scope?: string },
    prevRefresh: string | null = null,
  ): OAuthTokens {
    return {
      userId,
      provider: 'whoop',
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? prevRefresh,
      expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(),
      scope: r.scope ?? SCOPES,
    };
  }

  // ---------- signed OAuth state (CSRF + carries user id through the browser round-trip) ----------
  private signState(userId: string, target: 'app' | 'web' = 'app'): string {
    const payload = Buffer.from(JSON.stringify({ u: userId, r: target, t: Date.now(), n: randomBytes(8).toString('hex') })).toString(
      'base64url',
    );
    return `${payload}.${this.hmac(payload)}`;
  }

  private verifyState(state: string): string {
    const [payload, sig] = (state ?? '').split('.');
    if (!payload || !sig) throw new BadRequestException('Bad state');
    const expected = Buffer.from(this.hmac(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new BadRequestException('Bad state');
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - t > 15 * 60_000) throw new BadRequestException('State expired — try connecting again');
    return u;
  }

  private hmac(s: string) {
    return createHmac('sha256', this.req('OAUTH_STATE_SECRET')).update(s).digest('base64url');
  }

  private req(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new BadRequestException(`${key} is not configured`);
    return v;
  }
}

function addDaysIso(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
