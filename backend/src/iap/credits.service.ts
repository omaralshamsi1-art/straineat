import { createHash, sign as cryptoSign } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FETCH, FetchFn } from '../common/fetch';
import { REPOSITORY, Repository } from '../storage/repository';

/** Extra AI analyses bought in the iOS app (consumable In-App Purchase). They never expire. */
export const CREDIT_PACK = 30;
const IAP_OWNER = '__iap__';

interface Wallet { balance: number; bought: number; used: number; updatedAt: string }

/** Deterministic UUID that ties an App Store purchase to a StrainEat account (StoreKit appAccountToken). */
export function appAccountToken(userId: string): string {
  const h = createHash('sha256').update(`straineat:${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function decodeJws(jws: string): any {
  const part = String(jws).split('.')[1];
  if (!part) throw new Error('bad jws');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

@Injectable()
export class CreditsService {
  private readonly log = new Logger('Credits');
  private readonly fetchFn: FetchFn;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly config: ConfigService,
    @Optional() @Inject(FETCH) fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  get productId(): string {
    return this.config.get<string>('IAP_PRODUCT_ID') || `${this.bundleId}.analyses30`;
  }
  private get bundleId(): string {
    return this.config.get<string>('APPLE_BUNDLE_ID') || 'ae.sheen.straineat';
  }

  async wallet(userId: string): Promise<Wallet> {
    const p = (await this.repo.getCache(userId, 'ai-credits'))?.payload as Wallet | undefined;
    return { balance: 0, bought: 0, used: 0, updatedAt: '', ...(p ?? {}) };
  }

  /** Serialises wallet updates in-process so two requests can't double-spend. */
  private update<T>(userId: string, fn: (w: Wallet) => T | Promise<T>): Promise<T> {
    const job = this.chain.then(async () => {
      const w = await this.wallet(userId);
      const out = await fn(w);
      w.updatedAt = new Date().toISOString();
      await this.repo.setCache({ userId, key: 'ai-credits', payload: w, createdAt: w.updatedAt });
      return out;
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  /** Spends one credit if available. */
  spend(userId: string): Promise<boolean> {
    return this.update(userId, (w) => {
      if (w.balance <= 0) return false;
      w.balance -= 1; w.used += 1;
      return true;
    });
  }

  /** Gives a credit back (the analysis it paid for failed). */
  refund(userId: string): Promise<void> {
    return this.update(userId, (w) => { w.balance += 1; w.used = Math.max(0, w.used - 1); });
  }

  // ---------- App Store ----------

  private appleJwt(): string {
    const keyId = this.config.get<string>('APPLE_IAP_KEY_ID');
    const issuer = this.config.get<string>('APPLE_IAP_ISSUER_ID');
    const pem = this.config.get<string>('APPLE_IAP_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!keyId || !issuer || !pem) throw new ServiceUnavailableException('In-app purchases are not configured yet');
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1', bid: this.bundleId }));
    const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key: pem, dsaEncoding: 'ieee-p1363' });
    return `${head}.${body}.${b64url(sig)}`;
  }

  /** Asks Apple for the transaction (production first, then sandbox for TestFlight). The TLS answer is the proof. */
  private async lookup(transactionId: string): Promise<any> {
    const jwt = this.appleJwt();
    for (const host of ['https://api.storekit.itunes.apple.com', 'https://api.storekit-sandbox.itunes.apple.com']) {
      const res = await this.fetchFn(`${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (res.status === 404) continue;
      if (!res.ok) {
        this.log.warn(`App Store ${res.status} for ${transactionId}: ${(await res.text()).slice(0, 200)}`);
        throw new ServiceUnavailableException('Could not verify the purchase with Apple — try again shortly');
      }
      const data: any = await res.json();
      return decodeJws(data.signedTransactionInfo);
    }
    throw new BadRequestException('Purchase not found at Apple');
  }

  /** Verifies a consumable purchase and adds the pack once (idempotent per transaction). */
  async redeemApple(userId: string, transactionId: string) {
    const id = String(transactionId ?? '').trim();
    if (!/^\d{6,30}$/.test(id)) throw new BadRequestException('Invalid transaction id');
    const done = await this.repo.getCache(IAP_OWNER, `tx:${id}`);
    if (done) {
      if ((done.payload as any)?.userId !== userId) throw new BadRequestException('This purchase belongs to another account');
      return { ok: true, alreadyRedeemed: true, wallet: await this.wallet(userId) };
    }
    const tx = await this.lookup(id);
    if (tx.bundleId !== this.bundleId) throw new BadRequestException('Purchase is for a different app');
    if (tx.productId !== this.productId) throw new BadRequestException('Unknown product');
    if (tx.revocationDate) throw new BadRequestException('This purchase was refunded');
    if (tx.appAccountToken && String(tx.appAccountToken).toLowerCase() !== appAccountToken(userId)) {
      throw new BadRequestException('This purchase belongs to another account');
    }
    const qty = Math.max(1, Number(tx.quantity) || 1);
    const wallet = await this.update(userId, async (w) => {
      // re-check inside the lock so a double tap can't add the pack twice
      if (await this.repo.getCache(IAP_OWNER, `tx:${id}`)) return null;
      await this.repo.setCache({ userId: IAP_OWNER, key: `tx:${id}`, payload: { userId, productId: tx.productId, qty, env: tx.environment, at: new Date().toISOString() }, createdAt: new Date().toISOString() });
      w.balance += CREDIT_PACK * qty; w.bought += CREDIT_PACK * qty;
      return { ...w };
    });
    this.log.log(`IAP ${tx.environment ?? ''} ${id} → ${userId.slice(0, 6)} +${CREDIT_PACK * qty}`);
    return { ok: true, alreadyRedeemed: wallet === null, wallet: await this.wallet(userId) };
  }
}
