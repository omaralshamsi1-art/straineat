import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService } from '../src/auth/auth.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { AccountService } from '../src/account/account.service';
import { McpService } from '../src/mcp/mcp.service';
import { OAuthService } from '../src/mcp/oauth.service';

const cfg = new ConfigService({ AUTH_MODE: 'hybrid', API_KEY: 'k'.repeat(40), AUTH_JWT_SECRET: 's'.repeat(48), PUBLIC_BASE_URL: 'https://x.example' });
const ctx = (headers: Record<string, string>) => {
  const req: any = { headers };
  return { req, c: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => {}, getClass: () => class {} } as any };
};

describe('account deletion', () => {
  it('removes all data, kills the session and connector access; owner is protected', async () => {
    const repo = new MemoryRepository();
    const auth = new AuthService(repo, cfg, new ProfileService(repo));
    const guard = new AuthGuard(cfg, new Reflector(), auth);
    const oauth = new OAuthService(repo as any, cfg);
    const mcp = new McpService(repo as any, {} as any, {} as any, {} as any, {} as any, {} as any, oauth);
    const accounts = new AccountService(repo as any);

    const inv = await auth.createInvite('meera', 'owner');
    const { token } = await auth.register({ inviteCode: inv.code, email: 'a@b.co', password: 'longpassword1', name: 'A' } as any, {} as any);
    const s = ctx({ authorization: `Bearer ${token}` });
    await guard.canActivate(s.c);
    const uid = s.req.userId as string;

    const now = new Date().toISOString();
    await repo.saveMeal({ id: 'm1', userId: uid, date: '2026-11-26', eatenAt: now } as any);
    await repo.upsertWater({ id: 'w1', userId: uid, date: '2026-11-26', ml: 300, at: now } as any);
    await repo.upsertWeight({ userId: uid, date: '2026-11-26', kg: 70, source: 'manual' } as any);
    await repo.saveTokens({ userId: uid, provider: 'whoop', accessToken: 'a', refreshToken: 'r', expiresAt: now } as any);
    await repo.saveMeal({ id: 'other', userId: 'someone-else', date: '2026-11-26', eatenAt: now } as any);
    const key = (await mcp.token(uid)).token;
    expect(await mcp.userFor(key)).toBe(uid);

    await expect(accounts.deleteAccount(uid, 'user', 'nope')).rejects.toThrow(/DELETE/);
    await expect(accounts.deleteAccount('meera', 'owner', 'DELETE')).rejects.toThrow(/owner/);

    const r = await accounts.deleteAccount(uid, 'user', 'delete');
    auth.forget(uid);
    expect(r.deleted).toBe(true);
    expect(r.removed.users).toBe(1);
    expect(await repo.listMeals(uid, '2026-11-26')).toEqual([]);
    expect(await repo.listWater(uid, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(await repo.getTokens(uid, 'whoop')).toBeNull();
    expect(await repo.getUserById(uid)).toBeNull();
    expect(await repo.listMeals('someone-else', '2026-11-26')).toHaveLength(1);
    await expect(mcp.userFor(key)).rejects.toThrow();
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${token}` }).c)).rejects.toThrow();
  });
});
