import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthService } from './auth.service';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().userId;
});

/** 'owner' (server API key or owner account) or 'user' (invited account). */
export const Role = createParamDecorator((_: unknown, ctx: ExecutionContext): 'owner' | 'user' => {
  return ctx.switchToHttp().getRequest().role ?? 'user';
});

/** true when the request was authenticated with the server API key. */
export const ViaApiKey = createParamDecorator((_: unknown, ctx: ExecutionContext): boolean => {
  return !!ctx.switchToHttp().getRequest().viaApiKey;
});

/**
 * AUTH_MODE=supabase → verifies the Supabase access token (SUPABASE_JWKS_URL, or legacy SUPABASE_JWT_SECRET) and uses `sub`.
 * AUTH_MODE=apikey   → requires X-API-Key == API_KEY (private deployments).
 * AUTH_MODE=dev      → trusts the X-User-Id header (local development only).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const mode = resolveAuthMode(this.config.get<string>('AUTH_MODE'));
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);

    if (mode === 'hybrid' || mode === 'accounts') {
      // Owner: server API key (+ X-User-Id). Everyone else: Bearer token from /auth/login.
      const expected = this.config.get<string>('API_KEY');
      const key = req.headers['x-api-key'];
      if (mode === 'hybrid' && expected && typeof key === 'string' && key && safeEqual(key, expected)) {
        const id = req.headers['x-user-id'];
        req.userId = typeof id === 'string' && id ? id : 'owner';
        req.role = 'owner';
        req.viaApiKey = true;
        return true;
      }
      const auth: string | undefined = req.headers['authorization'];
      if (auth?.startsWith('Bearer ')) {
        try {
          const v = await this.auth.verifyToken(auth.slice(7));
          req.userId = v.userId;
          req.role = v.role;
          return true;
        } catch {
          if (!isPublic) throw new UnauthorizedException('Session expired — please sign in again');
        }
      }
      if (isPublic) return true;
      throw new UnauthorizedException();
    }
    if (isPublic) return true;

    if (mode === 'apikey') {
      // Single shared key for a private deployment; user id still comes from X-User-Id.
      const expected = this.config.get<string>('API_KEY');
      const given = req.headers['x-api-key'];
      if (!expected || typeof given !== 'string' || !safeEqual(given, expected)) throw new UnauthorizedException('Invalid API key');
      const id = req.headers['x-user-id'];
      req.userId = typeof id === 'string' && id ? id : 'owner';
      req.role = 'owner';
      req.viaApiKey = true;
      return true;
    }

    if (mode === 'dev') {
      const id = req.headers['x-user-id'];
      if (!id || typeof id !== 'string') throw new UnauthorizedException('X-User-Id header required in dev mode');
      req.userId = id;
      req.role = 'owner';
      return true;
    }

    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const jwksUrl = this.config.get<string>('SUPABASE_JWKS_URL');
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');
    if (!jwksUrl && !secret) throw new UnauthorizedException('Server auth not configured');
    try {
      // Newer Supabase projects sign with asymmetric keys (JWKS); legacy ones use the shared HS256 secret.
      const { payload } = jwksUrl
        ? await jwtVerify(auth.slice(7), (this.jwks ??= createRemoteJWKSet(new URL(jwksUrl))))
        : await jwtVerify(auth.slice(7), new TextEncoder().encode(secret!));
      if (!payload.sub) throw new Error('no sub');
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * AUTH_MODE, failing closed: dev mode (X-User-Id impersonation) is only the default for local/test runs.
 * With a database or NODE_ENV=production, a missing or unknown mode stops the server instead of opening it.
 */
export function resolveAuthMode(raw: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const mode = (raw ?? '').trim().toLowerCase();
  const prod = env.NODE_ENV === 'production' || !!env.DATABASE_URL;
  if (['hybrid', 'accounts', 'supabase', 'apikey'].includes(mode)) return mode;
  if (mode === 'dev' && !prod) return 'dev';
  if (!mode && !prod) return 'dev';
  if (mode === 'dev' && env.ALLOW_DEV_AUTH === 'true') return 'dev'; // explicit escape hatch for a throwaway database
  throw new Error(`Refusing to start: AUTH_MODE="${raw ?? ''}" is not allowed with a database/production (use hybrid, accounts or supabase).`);
}
