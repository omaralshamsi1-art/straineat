import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { localDate } from '../common/dates';
import { PlanService, addDays } from '../plan/plan.service';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { StepsService } from '../steps/steps.service';
import { WaterService } from '../water/water.service';
import { weekStart } from '../week/week.service';
import { DayStat, PERIODS, Period, TABS, Tab, loggingStreak, scoreMember } from './score';

const STORE = '__groups__';
const MAX_MEMBERS = 50;
const MAX_GROUPS_PER_USER = 10;
const BOARD_TTL_MS = 3 * 60_000;
const COLORS = ['#f3ef9e', '#b9a7f5', '#8fd3b6', '#f7b0a8', '#9cc8ff', '#f5c49a', '#c7e59a', '#f0a6d9'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export interface Member { userId: string; name: string; color: string; joinedAt: string; shareMilestones: boolean }
export interface Group { id: string; name: string; ownerId: string; code: string; members: Member[]; createdAt: string; deleted?: boolean }

const cleanName = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

/**
 * Private, invite-only challenge groups. Members see each other's display name, a % against their own
 * targets and a short sub-line — never weight, calories eaten or meals.
 */
@Injectable()
export class GroupsService {
  private readonly log = new Logger('Groups');
  private readonly boards = new Map<string, { at: number; data: unknown }>();
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
    private readonly plans: PlanService,
    private readonly water: WaterService,
    private readonly steps: StepsService,
  ) {}

  // ---------- storage ----------
  private async load(id: string): Promise<Group | null> {
    return ((await this.repo.getCache(STORE, `grp:${id}`))?.payload as Group) ?? null;
  }
  private async save(g: Group) {
    await this.repo.setCache({ userId: STORE, key: `grp:${g.id}`, payload: g as any, createdAt: new Date().toISOString() });
    for (const k of [...this.boards.keys()]) if (k.startsWith(`${g.id}|`)) this.boards.delete(k);
  }
  private async myIds(userId: string): Promise<string[]> {
    return (((await this.repo.getCache(userId, 'groups'))?.payload as any)?.ids as string[]) ?? [];
  }
  private async setMyIds(userId: string, ids: string[]) {
    await this.repo.setCache({ userId, key: 'groups', payload: { ids } as any, createdAt: new Date().toISOString() });
  }
  private async mustMember(userId: string, id: string): Promise<Group> {
    const g = await this.load(id);
    if (!g || g.deleted || !g.members.some((m) => m.userId === userId)) throw new NotFoundException('Group not found');
    return g;
  }
  private newCode(): string {
    const b = randomBytes(8);
    return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  }
  private async defaultName(userId: string): Promise<string> {
    const u = await this.repo.getUserById(userId).catch(() => null);
    return cleanName(u?.name?.split(/\s+/)[0], 24) || 'StrainEat';
  }

  // ---------- membership ----------
  async list(userId: string) {
    const ids = await this.myIds(userId);
    const out = [];
    for (const id of ids) {
      const g = await this.load(id);
      if (!g || g.deleted || !g.members.some((m) => m.userId === userId)) continue;
      out.push({ id: g.id, name: g.name, members: g.members.length, owner: g.ownerId === userId });
    }
    return out;
  }

  async create(userId: string, body: { name?: unknown; displayName?: unknown }) {
    const name = cleanName(body?.name, 40);
    if (!name) throw new BadRequestException('Group name is required');
    const ids = await this.myIds(userId);
    if (ids.length >= MAX_GROUPS_PER_USER) throw new BadRequestException(`You can be in up to ${MAX_GROUPS_PER_USER} groups`);
    const g: Group = {
      id: randomBytes(9).toString('base64url'), name, ownerId: userId, code: this.newCode(), createdAt: new Date().toISOString(),
      members: [{ userId, name: cleanName(body?.displayName, 24) || (await this.defaultName(userId)), color: COLORS[0], joinedAt: new Date().toISOString(), shareMilestones: false }],
    };
    await this.save(g);
    await this.repo.setCache({ userId: STORE, key: `grpcode:${g.code}`, payload: { id: g.id } as any, createdAt: g.createdAt });
    await this.setMyIds(userId, [...ids, g.id]);
    this.log.log(`group created ${g.id} (${name})`);
    return this.info(userId, g.id);
  }

  async preview(code: string) {
    const g = await this.byCode(code);
    return { name: g.name, members: g.members.length };
  }

  private async byCode(code: unknown): Promise<Group> {
    const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hit = c.length >= 6 ? ((await this.repo.getCache(STORE, `grpcode:${c}`))?.payload as { id?: string } | undefined) : undefined;
    const g = hit?.id ? await this.load(hit.id) : null;
    if (!g || g.deleted || g.code !== c) throw new NotFoundException('This invite link is invalid or was replaced');
    return g;
  }

  async join(userId: string, body: { code?: unknown; displayName?: unknown }) {
    const g = await this.byCode(body?.code);
    if (g.members.some((m) => m.userId === userId)) return this.info(userId, g.id);
    if (g.members.length >= MAX_MEMBERS) throw new BadRequestException('This group is full');
    const ids = await this.myIds(userId);
    if (ids.length >= MAX_GROUPS_PER_USER) throw new BadRequestException(`You can be in up to ${MAX_GROUPS_PER_USER} groups`);
    const used = new Set(g.members.map((m) => m.color));
    g.members.push({
      userId, name: cleanName(body?.displayName, 24) || (await this.defaultName(userId)),
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[g.members.length % COLORS.length], joinedAt: new Date().toISOString(), shareMilestones: false,
    });
    await this.save(g);
    await this.setMyIds(userId, [...ids.filter((x) => x !== g.id), g.id]);
    return this.info(userId, g.id);
  }

  async info(userId: string, id: string) {
    const g = await this.mustMember(userId, id);
    const me = g.members.find((m) => m.userId === userId)!;
    return {
      id: g.id, name: g.name, owner: g.ownerId === userId, code: g.code,
      me: { name: me.name, color: me.color, shareMilestones: me.shareMilestones },
      members: g.members.map((m) => ({ id: memberId(g, m), name: m.name, color: m.color, me: m.userId === userId, owner: m.userId === g.ownerId })),
    };
  }

  async updateMe(userId: string, id: string, body: { displayName?: unknown; shareMilestones?: unknown }) {
    const g = await this.mustMember(userId, id);
    const me = g.members.find((m) => m.userId === userId)!;
    if (body?.displayName !== undefined) me.name = cleanName(body.displayName, 24) || me.name;
    if (body?.shareMilestones !== undefined) me.shareMilestones = !!body.shareMilestones;
    await this.save(g);
    return this.info(userId, id);
  }

  async rename(userId: string, id: string, name: unknown) {
    const g = await this.mustMember(userId, id);
    if (g.ownerId !== userId) throw new ForbiddenException('Only the group owner can rename it');
    const n = cleanName(name, 40);
    if (!n) throw new BadRequestException('Group name is required');
    g.name = n;
    await this.save(g);
    return this.info(userId, id);
  }

  /** New invite code; the old link stops working. Owner only. */
  async rotateCode(userId: string, id: string) {
    const g = await this.mustMember(userId, id);
    if (g.ownerId !== userId) throw new ForbiddenException('Only the group owner can reset the invite link');
    await this.repo.setCache({ userId: STORE, key: `grpcode:${g.code}`, payload: { id: null } as any, createdAt: new Date().toISOString() });
    g.code = this.newCode();
    await this.repo.setCache({ userId: STORE, key: `grpcode:${g.code}`, payload: { id: g.id } as any, createdAt: new Date().toISOString() });
    await this.save(g);
    return this.info(userId, id);
  }

  async removeMember(userId: string, id: string, memberKey: string) {
    const g = await this.mustMember(userId, id);
    if (g.ownerId !== userId) throw new ForbiddenException('Only the group owner can remove members');
    const m = g.members.find((x) => memberId(g, x) === memberKey);
    if (!m || m.userId === userId) throw new BadRequestException('Can’t remove that member');
    await this.drop(g, m.userId);
    return this.info(userId, id);
  }

  async leave(userId: string, id: string) {
    const g = await this.mustMember(userId, id);
    await this.drop(g, userId);
    return { left: true };
  }

  /** Remove a user from a group; ownership passes to the longest-standing member; an empty group is deleted. */
  private async drop(g: Group, userId: string) {
    g.members = g.members.filter((m) => m.userId !== userId);
    await this.setMyIds(userId, (await this.myIds(userId)).filter((x) => x !== g.id));
    if (!g.members.length) {
      g.deleted = true;
      await this.repo.setCache({ userId: STORE, key: `grpcode:${g.code}`, payload: { id: null } as any, createdAt: new Date().toISOString() });
    } else if (g.ownerId === userId) g.ownerId = g.members[0].userId;
    await this.save(g);
  }

  /** Account deletion: leave every group. */
  async removeEverywhere(userId: string) {
    for (const id of await this.myIds(userId)) {
      const g = await this.load(id);
      if (g && g.members.some((m) => m.userId === userId)) await this.drop(g, userId);
    }
  }

  // ---------- scoring ----------
  /** `since` = when the member joined the group: days before that don't count against them. */
  private async memberDays(userId: string, period: Period, since?: string): Promise<{ days: DayStat[]; progressPct: number | null }> {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    let from = period === 'day' ? today : period === 'week' ? weekStart(today) : `${today.slice(0, 8)}01`;
    if (since) { const joined = localDate(new Date(since), profile.timezone); if (joined > from) from = joined > today ? today : joined; }
    const n = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
    const [hist, plan] = await Promise.all([this.plans.history(userId, n), this.plans.plan(userId)]);
    // the user's own recent average strain (28 days before the period) for the effort tab
    const strainOf = async (d: string) => (((await this.repo.getCache(userId, `whoop-day:${d}`))?.payload as any)?.strain as number | undefined) ?? null;
    const past = (await Promise.all(Array.from({ length: 28 }, (_, i) => strainOf(addDays(from, -(i + 1)))))).filter((x): x is number => x != null && x > 0);
    const strainAvg = past.length >= 5 ? past.reduce((a, x) => a + x, 0) / past.length : null;
    const days: DayStat[] = [];
    for (const h of hist.days) {
      const [w, s, st] = await Promise.all([this.water.day(userId, h.date).catch(() => null), this.steps.day(userId, h.date).catch(() => null), strainOf(h.date)]);
      days.push({
        date: h.date, meals: h.meals, intakeKcal: h.intakeKcal, targetKcal: h.targetKcal, proteinG: h.proteinG, proteinTarget: plan.proteinG || null,
        waterMl: w?.intakeMl ?? null, waterTarget: w?.targetMl ?? null, steps: s?.steps ?? null, stepGoal: s?.goal ?? null,
        strain: st, strainAvg, goal: (plan.effectiveGoal as DayStat['goal']) ?? 'maintain',
      });
    }
    return { days, progressPct: plan.progressPct ?? null };
  }

  async board(userId: string, id: string, tabIn?: string, periodIn?: string) {
    const tab = (TABS as string[]).includes(tabIn ?? '') ? (tabIn as Tab) : 'total';
    const period = (PERIODS as string[]).includes(periodIn ?? '') ? (periodIn as Period) : 'week';
    const g = await this.mustMember(userId, id);
    const key = `${g.id}|${tab}|${period}`;
    let data = this.boards.get(key);
    if (!data || Date.now() - data.at > BOARD_TTL_MS) {
      const rows = [];
      for (const m of g.members) {
        const { days } = await this.memberDays(m.userId, period, m.joinedAt).catch(() => ({ days: [] as DayStat[] }));
        const sc = scoreMember(tab, period, days);
        if (sc) rows.push({ uid: m.userId, id: memberId(g, m), name: m.name, color: m.color, pct: sc.pct, detail: sc.detail });
      }
      rows.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
      data = { at: Date.now(), data: rows };
      this.boards.set(key, data);
    }
    // Others never see how much someone ate or their protein grams — only whether they hit the target.
    const privateValue = (tab === 'calories' || tab === 'protein');
    const rows = (data.data as any[]).map((r, i) => {
      const me = r.uid === userId;
      const detail = !me && privateValue && r.detail.kind === 'value' ? { kind: 'status', ok: r.pct >= (tab === 'calories' ? 100 : 90) } : r.detail;
      return { rank: i + 1, id: r.id, name: r.name, color: r.color, pct: r.pct, detail, me };
    });
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + Math.min(r.pct, 100), 0) / rows.length) : null;
    return {
      group: { id: g.id, name: g.name, members: g.members.length, owner: g.ownerId === userId },
      tab, period, updatedAt: new Date(data.at).toISOString(), average: avg,
      champion: rows[0] && rows[0].pct > 0 ? { name: rows[0].name, pct: rows[0].pct, me: rows[0].me } : null,
      rows, me: rows.find((r) => r.me) ?? null,
      hasStrain: tab === 'strain' ? rows.length > 0 : undefined,
    };
  }

  /** Recent wins in the group: logging streaks, a strong protein week, and (opt-in, no numbers) weight-goal milestones. */
  async feed(userId: string, id: string) {
    const g = await this.mustMember(userId, id);
    const items: { kind: 'streak' | 'protein' | 'milestone'; name: string; me: boolean; n: number }[] = [];
    for (const m of g.members) {
      const { days, progressPct } = await this.memberDays(m.userId, 'month').catch(() => ({ days: [] as DayStat[], progressPct: null }));
      const me = m.userId === userId;
      const streak = loggingStreak(days);
      if (streak >= 7) items.push({ kind: 'streak', name: m.name, me, n: streak });
      const week = days.slice(-7);
      const prot = week.filter((d) => d.proteinTarget && d.meals > 0 && d.proteinG >= d.proteinTarget * 0.9).length;
      if (prot >= 5) items.push({ kind: 'protein', name: m.name, me, n: prot });
      if (m.shareMilestones && progressPct != null && progressPct >= 25) items.push({ kind: 'milestone', name: m.name, me, n: Math.floor(progressPct / 25) * 25 });
    }
    items.sort((a, b) => (b.kind === 'milestone' ? 1 : 0) - (a.kind === 'milestone' ? 1 : 0) || b.n - a.n);
    return { items: items.slice(0, 8) };
  }
}

/** Stable, non-guessable id for a member inside one group (never the account id). */
export function memberId(g: Pick<Group, 'id'>, m: Pick<Member, 'userId'>): string {
  let h = 2166136261;
  for (const ch of `${g.id}:${m.userId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
