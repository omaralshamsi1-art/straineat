import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { jwtVerify, SignJWT } from 'jose';
import { User } from '../common/types';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';

const SCRYPT_N = 16384;
const TOKEN_DAYS = 30;
const INVITE_DAYS = 14;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, salt, hash] = (stored ?? '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const normEmail = (e: string) => String(e ?? '').trim().toLowerCase();

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { n: number; first: number }>();

  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly config: ConfigService,
    private readonly profiles: ProfileService,
  ) {}

  private secret(): Uint8Array {
    const s = this.config.get<string>('AUTH_JWT_SECRET');
    if (!s || s.length < 32) throw new HttpException('Accounts are not configured on the server', HttpStatus.SERVICE_UNAVAILABLE);
    return new TextEncoder().encode(s);
  }

  async issueToken(u: Pick<User, 'id' | 'role'>): Promise<string> {
    return new SignJWT({ role: u.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_DAYS}d`)
      .setIssuer('straineat')
      .sign(this.secret());
  }

  async verifyToken(token: string): Promise<{ userId: string; role: 'owner' | 'user' }> {
    const { payload } = await jwtVerify(token, this.secret(), { issuer: 'straineat' });
    if (!payload.sub) throw new UnauthorizedException();
    // A deleted account's sessions must stop working immediately (JWTs are otherwise stateless).
    if (!(await this.userExists(payload.sub))) throw new UnauthorizedException('This account no longer exists');
    return { userId: payload.sub, role: payload.role === 'owner' ? 'owner' : 'user' };
  }

  private readonly seen = new Map<string, number>();
  /** Account-exists check, cached 60 s per user so it costs ~one query a minute. */
  private async userExists(id: string): Promise<boolean> {
    const t = this.seen.get(id);
    if (t && Date.now() - t < 60_000) return true;
    const ok = !!(await this.repo.getUserById(id));
    if (ok) this.seen.set(id, Date.now()); else this.seen.delete(id);
    return ok;
  }
  forget(id: string) { this.seen.delete(id); }

  /** Simple brute-force protection: 10 failed attempts per email per 15 minutes. */
  private throttle(key: string, failed: boolean) {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (a && now - a.first > 15 * 60_000) this.attempts.delete(key);
    const cur = this.attempts.get(key);
    if (!failed) return cur && cur.n >= 10;
    this.attempts.set(key, cur ? { n: cur.n + 1, first: cur.first } : { n: 1, first: now });
    return false;
  }

  private validate(body: { email?: string; password?: string; name?: string }) {
    const email = normEmail(body.email ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new BadRequestException('بريد إلكتروني غير صالح');
    const password = String(body.password ?? '');
    if (password.length < 8 || password.length > 200) throw new BadRequestException('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    const name = String(body.name ?? '').trim().slice(0, 60) || email.split('@')[0];
    return { email, password, name };
  }

  /**
   * Register with an invite code. The owner (authenticated by the server API key) may instead
   * `claimUserId` to attach an email login to existing data (e.g. "meera").
   */
  async register(
    body: { email?: string; password?: string; name?: string; inviteCode?: string; claimUserId?: string },
    caller: { role?: 'owner' | 'user'; viaApiKey?: boolean },
  ) {
    const { email, password, name } = this.validate(body);
    if (await this.repo.getUserByEmail(email)) throw new ConflictException('هذا البريد مسجّل مسبقاً');
    const now = new Date().toISOString();
    let id: string;
    let role: User['role'] = 'user';
    if (body.claimUserId) {
      if (!caller.viaApiKey) throw new ForbiddenException('Only the server owner can claim existing data');
      id = String(body.claimUserId).slice(0, 64);
      if (await this.repo.getUserById(id)) throw new ConflictException('هذا الحساب مرتبط مسبقاً');
      role = 'owner';
    } else {
      const code = String(body.inviteCode ?? '').trim().toUpperCase();
      const invite = code ? await this.repo.getInvite(code) : null;
      if (!invite || invite.usedBy || invite.expiresAt < now) throw new BadRequestException('رمز الدعوة غير صالح أو منتهي');
      id = randomUUID();
      if (!(await this.repo.useInvite(code, id, now))) throw new BadRequestException('رمز الدعوة غير صالح أو منتهي');
    }
    await this.repo.createUser({ id, email, name, passwordHash: hashPassword(password), role, createdAt: now });
    return { token: await this.issueToken({ id, role }), user: { id, email, name, role } };
  }

  async login(body: { email?: string; password?: string }) {
    const email = normEmail(body.email ?? '');
    if (this.throttle(email, false)) throw new HttpException('محاولات كثيرة، حاول بعد 15 دقيقة', HttpStatus.TOO_MANY_REQUESTS);
    const u = email ? await this.repo.getUserByEmail(email) : null;
    if (!u || !verifyPassword(String(body.password ?? ''), u.passwordHash)) {
      this.throttle(email, true);
      throw new UnauthorizedException('البريد أو كلمة المرور غير صحيحة');
    }
    return { token: await this.issueToken(u), user: { id: u.id, email: u.email, name: u.name, role: u.role } };
  }

  async me(userId: string, role: string) {
    const u = await this.repo.getUserById(userId);
    return u
      ? { id: u.id, email: u.email, name: u.name, role: u.role, account: true }
      : { id: userId, email: null, name: userId, role, account: false };
  }

  async createInvite(ownerId: string, role: string) {
    if (role !== 'owner') throw new ForbiddenException('Only the owner can invite');
    let code = '';
    const bytes = randomBytes(8);
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
    const now = new Date();
    const invite = { code, createdBy: ownerId, usedBy: null, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString() };
    await this.repo.createInvite(invite);
    return invite;
  }

  async listInvites(ownerId: string, role: string) {
    if (role !== 'owner') throw new ForbiddenException();
    const list = await this.repo.listInvites(ownerId);
    const out = [];
    for (const i of list) {
      const u = i.usedBy ? await this.repo.getUserById(i.usedBy) : null;
      out.push({ ...i, usedByName: u?.name ?? null });
    }
    return out;
  }
}

/** Per-user daily AI quotas (owner unlimited). */
const lim = (name: string, d: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};
/** Per-user daily caps (owner exempt). Photo + text analyses share `analyze`. */
export const DAILY_LIMITS = {
  analyze: lim('AI_DAILY_LIMIT', 15),
  coach: lim('AI_COACH_DAILY_LIMIT', 12),
  chat: lim('AI_CHAT_DAILY_LIMIT', 30),
} as const;

@Injectable()
export class UsageService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async consume(userId: string, role: string | undefined, kind: keyof typeof DAILY_LIMITS) {
    if (role === 'owner') return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `usage:${day}:${kind}`;
    const cur = (await this.repo.getCache(userId, key))?.payload as { n: number } | undefined;
    const n = (cur?.n ?? 0) + 1;
    if (n > DAILY_LIMITS[kind]) {
      throw new HttpException(
        kind === 'analyze'
          ? `وصلت للحد اليومي لتحليل الصور (${DAILY_LIMITS.analyze}). جرّب غداً أو أضف الوجبة من المفضلة.`
          : kind === 'chat'
            ? `وصلت للحد اليومي لرسائل المساعد (${DAILY_LIMITS.chat}). جرّب غداً.`
            : `وصلت للحد اليومي لطلبات المدرب (${DAILY_LIMITS.coach}).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.repo.setCache({ userId, key, payload: { n }, createdAt: new Date().toISOString() });
  }
}
