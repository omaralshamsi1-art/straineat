import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { isIsoDate, localDate } from '../common/dates';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { EnergyService } from './energy.service';

/**
 * Apple Health without the iOS app: an iPhone Shortcut reads Active + Resting energy and POSTs them here with a
 * personal sync token (only its SHA-256 is stored for lookup).
 */
const LOOKUP_USER = '__shortcut__';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Shortcuts may send 512, "512.3", "1,240 kcal" or a list of values — take the number(s) and sum. */
export function kcalOf(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) {
    const xs = v.map(kcalOf).filter((x): x is number => x != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,٬]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).match(/-?\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n >= 0 && n < 20000 ? Math.round(n) : null;
}

@Injectable()
export class ShortcutService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly energy: EnergyService,
    private readonly profiles: ProfileService,
  ) {}

  async token(userId: string, rotate = false) {
    const mine = await this.repo.getCache(userId, 'shortcut-token');
    const old = (mine?.payload as any)?.token as string | undefined;
    if (old && !rotate) return { token: old };
    if (old) await this.repo.setCache({ userId: LOOKUP_USER, key: `tok:${hash(old)}`, payload: { revoked: true }, createdAt: new Date().toISOString() });
    const token = randomBytes(18).toString('base64url');
    const now = new Date().toISOString();
    await this.repo.setCache({ userId: LOOKUP_USER, key: `tok:${hash(token)}`, payload: { userId }, createdAt: now });
    await this.repo.setCache({ userId, key: 'shortcut-token', payload: { token }, createdAt: now });
    return { token };
  }

  async ingest(token: string | undefined, body: Record<string, unknown>) {
    if (!token || token.length < 16) throw new UnauthorizedException('Missing sync token');
    const hit = await this.repo.getCache(LOOKUP_USER, `tok:${hash(token.trim())}`);
    const userId = (hit?.payload as any)?.userId as string | undefined;
    if (!userId) throw new UnauthorizedException('Invalid sync token');
    // Also accept the common Shortcuts mix-up where the Health number went into the Key column
    // and the word "active"/"basal" into the value: { "612.4": "active" }.
    const swapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      const name = typeof v === 'string' ? v.trim().toLowerCase() : '';
      if (['active', 'basal', 'resting'].includes(name) && kcalOf(k) != null) swapped[name] = k;
    }
    const active = kcalOf(body?.active ?? body?.activeKcal ?? swapped.active);
    const basal = kcalOf(body?.basal ?? body?.basalKcal ?? body?.resting ?? swapped.basal ?? swapped.resting);
    if (active == null && basal == null) {
      const got = Object.keys(body ?? {}).slice(0, 5).join(', ') || 'nothing';
      throw new BadRequestException(`Send JSON like {"active": 612, "basal": 1650}: Key = the word active / basal, value = the Health number. Received keys: ${got}`);
    }
    const p = await this.profiles.get(userId);
    const date = isIsoDate(body?.date) ? (body.date as string) : localDate(new Date(), p.timezone);
    await this.energy.ingest(userId, [{ date, source: 'apple_health', activeKcal: active, basalKcal: basal } as any]);
    await this.repo.setCache({ userId, key: 'shortcut-last', payload: { at: new Date().toISOString(), date, active, basal }, createdAt: new Date().toISOString() });
    return { ok: true, date, activeKcal: active, basalKcal: basal, totalKcal: (active ?? 0) + (basal ?? 0) };
  }

  async status(userId: string) {
    const last = await this.repo.getCache(userId, 'shortcut-last');
    return { last: last?.payload ?? null };
  }
}
