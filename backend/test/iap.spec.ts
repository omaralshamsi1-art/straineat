import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MemoryRepository } from '../src/storage/memory.repository';
import { appAccountToken, CreditsService } from '../src/iap/credits.service';
import { DAILY_LIMITS, UsageService } from '../src/auth/auth.service';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const cfg = new ConfigService({ APPLE_IAP_KEY_ID: 'KEY123', APPLE_IAP_ISSUER_ID: 'iss', APPLE_IAP_PRIVATE_KEY: pem.replace(/\n/g, '\\n') });
const jws = (p: any) => `h.${Buffer.from(JSON.stringify(p)).toString('base64url')}.s`;
const tx = (o: any = {}) => ({ transactionId: '2000000123', bundleId: 'ae.sheen.straineat', productId: 'ae.sheen.straineat.analyses30', quantity: 1, environment: 'Sandbox', ...o });

function setup(txInfo: any, prod404 = true) {
  const repo = new MemoryRepository();
  const calls: any[] = [];
  const fetchFn: any = vi.fn(async (url: string, init: any) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (prod404 && url.includes('api.storekit.itunes')) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ signedTransactionInfo: jws(txInfo) }) };
  });
  const credits = new CreditsService(repo as any, cfg, fetchFn);
  const usage = new UsageService(repo as any, credits);
  return { repo, credits, usage, calls };
}

describe('Extra analyses (IAP credits)', () => {
  it('verifies with Apple (falls back to sandbox), adds 30 once, and rejects reuse by another account', async () => {
    const s = setup(tx({ appAccountToken: appAccountToken('u1') }));
    const r = await s.credits.redeemApple('u1', '2000000123');
    expect(r.wallet.balance).toBe(30);
    expect(s.calls.map((c) => new URL(c.url).host)).toEqual(['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com']);
    const [h] = s.calls[0].auth.replace('Bearer ', '').split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toMatchObject({ alg: 'ES256', kid: 'KEY123' });
    const again = await s.credits.redeemApple('u1', '2000000123');
    expect(again.alreadyRedeemed).toBe(true);
    expect(again.wallet.balance).toBe(30);
    await expect(s.credits.redeemApple('u2', '2000000123')).rejects.toThrow(/another account/);
  });

  it('rejects wrong product, refunded purchases and purchases tied to another account', async () => {
    await expect(setup(tx({ productId: 'other' })).credits.redeemApple('u1', '2000000123')).rejects.toThrow(/Unknown product/);
    await expect(setup(tx({ revocationDate: 1 })).credits.redeemApple('u1', '2000000123')).rejects.toThrow(/refunded/);
    await expect(setup(tx({ appAccountToken: appAccountToken('u9') })).credits.redeemApple('u1', '2000000123')).rejects.toThrow(/another account/);
    await expect(setup(tx()).credits.redeemApple('u1', 'abc')).rejects.toThrow(/Invalid/);
  });

  it('after the free daily limit, analyses spend credits; with none left the error offers a purchase', async () => {
    expect(await setup(tx()).credits.redeemApple('u1', '2000000123').catch((e) => e.message)).toMatch(/another account/); // untagged purchase
    const s = setup(tx({ appAccountToken: appAccountToken('u1') }));
    for (let i = 0; i < DAILY_LIMITS.analyze; i++) expect(await s.usage.consume('u1', 'user', 'analyze')).toBe('free');
    const err: any = await s.usage.consume('u1', 'user', 'analyze').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'AI_LIMIT', canBuy: true });
    await s.credits.redeemApple('u1', '2000000123');
    expect(await s.usage.consume('u1', 'user', 'analyze')).toBe('credit');
    expect((await s.credits.wallet('u1')).balance).toBe(29);
    await s.credits.refund('u1');
    expect((await s.credits.wallet('u1')).balance).toBe(30);
    expect(await s.usage.consume('u1', 'owner', 'analyze')).toBe('owner');
  });

  it('is unavailable until the App Store key is configured', async () => {
    const c = new CreditsService(new MemoryRepository() as any, new ConfigService({}), vi.fn() as any);
    await expect(c.redeemApple('u1', '2000000123')).rejects.toThrow(/not configured/);
  });
});
