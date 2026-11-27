import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/storage/memory.repository';
import { ProfileService } from '../src/profile/profile.service';
import { PlanService } from '../src/plan/plan.service';
import { WaterService } from '../src/water/water.service';
import { StepsService } from '../src/steps/steps.service';
import { GroupsService } from '../src/groups/groups.service';
import { DayStat, calorieScore, dayPoints, loggingStreak, scoreMember } from '../src/groups/score';

const day = (o: Partial<DayStat> = {}): DayStat => ({
  date: '2026-11-27', meals: 3, intakeKcal: 1700, targetKcal: 1760, proteinG: 150, proteinTarget: 160, waterMl: 3000, waterTarget: 3000,
  steps: 9500, stepGoal: 9000, strain: null, strainAvg: null, goal: 'lose', ...o,
});

describe('challenge scoring', () => {
  it('scores calories on staying inside the target band — eating very little never wins', () => {
    expect(calorieScore(day())).toBe(100);
    expect(calorieScore(day({ intakeKcal: 800 }))).toBeLessThan(100); // starving is below the band
    expect(calorieScore(day({ intakeKcal: 800 }))).toBeLessThan(calorieScore(day({ intakeKcal: 1300 })));
    expect(calorieScore(day({ intakeKcal: 2400 }))).toBeLessThan(100);
    expect(calorieScore(day({ meals: 0, intakeKcal: 0 }))).toBe(0);
  });

  it('awards 14 points for a perfect day', () => {
    expect(dayPoints(day())).toBe(14);
    expect(dayPoints(day({ steps: 2000, waterMl: 500 }))).toBe(9);
  });

  it('measures each person against their own goal (a beginner can beat an athlete)', () => {
    const beginner = scoreMember('steps', 'day', [day({ steps: 6000, stepGoal: 5000 })])!;
    const athlete = scoreMember('steps', 'day', [day({ steps: 12000, stepGoal: 15000 })])!;
    expect(beginner.pct).toBeGreaterThan(athlete.pct);
    expect(beginner.detail).toMatchObject({ kind: 'value', value: 6000, target: 5000 });
  });

  it('week view counts consistency; total is points of the max', () => {
    const wk = [day(), day({ proteinG: 50 }), day({ proteinG: 155 })];
    const p = scoreMember('protein', 'week', wk)!;
    expect(p.detail).toMatchObject({ kind: 'days', hit: 2, of: 3 });
    const t = scoreMember('total', 'week', wk)!;
    expect(t.detail).toMatchObject({ kind: 'points', points: 14 + 11 + 14, max: 42 });
  });

  it('strain tab only for people with WHOOP history', () => {
    expect(scoreMember('strain', 'day', [day()])).toBeNull();
    expect(scoreMember('strain', 'day', [day({ strain: 15, strainAvg: 10 })])!.pct).toBe(150);
  });

  it('logging streak tolerates an empty today', () => {
    expect(loggingStreak([day(), day(), day({ meals: 0 })])).toBe(2);
    expect(loggingStreak([day({ meals: 0 }), day(), day()])).toBe(2);
  });
});

describe('groups', () => {
  const make = () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const svc = new GroupsService(repo as any, profiles, plans, new WaterService(repo as any, profiles), new StepsService(repo as any, profiles));
    return { repo, svc };
  };

  it('create → invite → join → board → leave; members never see account ids or weights', async () => {
    const { svc } = make();
    const g = await svc.create('owner', { name: 'SHEEN team', displayName: 'Meera' });
    expect(g.owner).toBe(true);
    expect(g.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await svc.preview(g.code.toLowerCase())).toEqual({ name: 'SHEEN team', members: 1 });
    await svc.join('friend', { code: g.code, displayName: 'Sara' });
    const info = await svc.info('friend', g.id);
    expect(info.members.map((m) => m.name)).toEqual(['Meera', 'Sara']);
    expect(JSON.stringify(info.members)).not.toMatch(/friend|"owner":\s*"owner"/);
    const board = await svc.board('friend', g.id, 'total', 'week');
    expect(board.rows).toHaveLength(2);
    expect(JSON.stringify(board)).not.toMatch(/kg|weight|intake/i);
    expect(board.rows.find((r) => r.me)!.name).toBe('Sara');
    await expect(svc.board('stranger', g.id)).rejects.toThrow();
    const cal = await svc.board('friend', g.id, 'calories', 'day');
    for (const r of cal.rows.filter((x) => !x.me)) expect(r.detail.kind).not.toBe('value');
    await svc.leave('owner', g.id);
    const after = await svc.info('friend', g.id);
    expect(after.owner).toBe(true); // ownership passed on
    expect(await svc.list('owner')).toEqual([]);
  });

  it('rotating the invite code kills the old link; only the owner can do it', async () => {
    const { svc } = make();
    const g = await svc.create('o', { name: 'Fam' });
    await svc.join('a', { code: g.code });
    await expect(svc.rotateCode('a', g.id)).rejects.toThrow();
    const r = await svc.rotateCode('o', g.id);
    expect(r.code).not.toBe(g.code);
    await expect(svc.join('b', { code: g.code })).rejects.toThrow(/invalid/);
    await svc.join('b', { code: r.code });
    expect((await svc.info('o', g.id)).members).toHaveLength(3);
  });

  it('owner can remove a member; account deletion leaves every group', async () => {
    const { svc } = make();
    const g = await svc.create('o', { name: 'Gym' });
    await svc.join('a', { code: g.code });
    await svc.join('b', { code: g.code });
    const a = (await svc.info('o', g.id)).members.find((m) => !m.me && m.name)!;
    await svc.removeMember('o', g.id, a.id);
    expect((await svc.info('o', g.id)).members).toHaveLength(2);
    await svc.removeEverywhere('b');
    expect((await svc.info('o', g.id)).members).toHaveLength(1);
  });
});
