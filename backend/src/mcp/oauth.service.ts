import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { REPOSITORY, Repository } from '../storage/repository';

/**
 * Minimal OAuth 2.1 authorization server for the StrainEat MCP connector
 * (MCP authorization spec: RFC 9728 protected-resource metadata, RFC 8414 AS metadata,
 * RFC 7591 dynamic client registration, authorization code + PKCE S256, rotating refresh tokens).
 * The user signs in and consents inside the StrainEat web app; tokens only reach the MCP tools.
 */
const LOOKUP = '__lookup__';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const rnd = (n = 32) => randomBytes(n).toString('base64url');
const now = () => Date.now();
export const OAUTH_SCOPE = 'straineat';
export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 90 * 86400_000;
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_TTL_MS = 15 * 60_000;

export interface OAuthClient { client_id: string; client_name: string; redirect_uris: string[]; secretHash?: string; auth_method: string; createdAt: string }
interface Grant { name: string; host: string; gen: number; createdAt: string; lastUsedAt?: string; revoked?: boolean }

export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) { super(description); }
}

/** https only, except loopback http for native/desktop clients; no fragments. */
export function validRedirect(u: string): boolean {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
  } catch { return false; }
}

export function pkceOk(verifier: string | undefined, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class OAuthService {
  private readonly log = new Logger('OAuth');
  constructor(@Inject(REPOSITORY) private readonly repo: Repository, private readonly config: ConfigService) {}

  base(req?: { headers?: any; protocol?: string }): string {
    const fixed = (this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    if (fixed) return fixed;
    const h = req?.headers ?? {};
    const proto = String(h['x-forwarded-proto'] ?? req?.protocol ?? 'http').split(',')[0];
    return `${proto}://${h['x-forwarded-host'] ?? h.host ?? 'localhost'}`;
  }

  resourceMetadata(base: string) {
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'StrainEat',
      resource_documentation: `${base}/app/`,
    };
  }

  serverMetadata(base: string) {
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: [OAUTH_SCOPE],
      service_documentation: `${base}/app/`,
    };
  }

  // ---------- storage helpers ----------
  private async get<T>(key: string): Promise<T | null> {
    return ((await this.repo.getCache(LOOKUP, key))?.payload as T) ?? null;
  }
  private async put(key: string, payload: unknown) {
    await this.repo.setCache({ userId: LOOKUP, key, payload: payload as any, createdAt: new Date().toISOString() });
  }
  private async grants(userId: string): Promise<Record<string, Grant>> {
    return (((await this.repo.getCache(userId, 'oauth-grants'))?.payload as any)?.clients as Record<string, Grant>) ?? {};
  }
  private async saveGrants(userId: string, clients: Record<string, Grant>) {
    await this.repo.setCache({ userId, key: 'oauth-grants', payload: { clients } as any, createdAt: new Date().toISOString() });
  }

  // ---------- RFC 7591 dynamic client registration ----------
  async register(body: any) {
    const uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1–10 https URLs (or loopback http)');
    }
    const grantTypes: string[] = body?.grant_types ?? ['authorization_code'];
    if (!grantTypes.every((g) => ['authorization_code', 'refresh_token'].includes(g))) throw new OAuthError('invalid_client_metadata', 'unsupported grant_types');
    const method = ['client_secret_post', 'client_secret_basic'].includes(body?.token_endpoint_auth_method) ? body.token_endpoint_auth_method : 'none';
    const client_id = `se_${rnd(18)}`;
    const secret = method === 'none' ? undefined : rnd(32);
    const client_name = String(body?.client_name ?? '').trim().slice(0, 60) || new URL(uris[0]).hostname;
    const c: OAuthClient = { client_id, client_name, redirect_uris: uris, secretHash: secret ? sha(secret) : undefined, auth_method: method, createdAt: new Date().toISOString() };
    await this.put(`oc:${client_id}`, c);
    this.log.log(`registered client ${client_id} "${client_name}" → ${new URL(uris[0]).host}`);
    return {
      client_id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(now() / 1000),
      client_name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      scope: OAUTH_SCOPE,
    };
  }

  async client(id: string | undefined): Promise<OAuthClient | null> {
    return id ? this.get<OAuthClient>(`oc:${id}`) : null;
  }

  // ---------- authorize ----------
  /**
   * Validates the request. Returns either a consent-request id (redirect the browser to the web app)
   * or a redirect back to the client with an error. Throws when the redirect_uri itself can't be trusted.
   */
  async startAuthorize(q: Record<string, string | undefined>): Promise<{ requestId?: string; redirect?: string }> {
    const c = await this.client(q.client_id);
    if (!c) throw new OAuthError('invalid_client', 'Unknown client_id — the app must register first');
    const redirectUri = q.redirect_uri ?? (c.redirect_uris.length === 1 ? c.redirect_uris[0] : undefined);
    if (!redirectUri || !c.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'redirect_uri does not match the registered ones');
    const back = (error: string, desc: string) => ({ redirect: withParams(redirectUri, { error, error_description: desc, state: q.state }) });
    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    if (q.scope && !q.scope.split(' ').every((s) => s === OAUTH_SCOPE || s === '')) return back('invalid_scope', `Only scope "${OAUTH_SCOPE}" is available`);
    const requestId = rnd(24);
    await this.put(`oq:${requestId}`, {
      clientId: c.client_id, redirectUri, codeChallenge: q.code_challenge, state: q.state ?? null, resource: q.resource ?? null, exp: now() + REQUEST_TTL_MS,
    });
    return { requestId };
  }

  private async request(id: string) {
    const r = await this.get<any>(`oq:${id}`);
    if (!r || r.done || r.exp < now()) throw new NotFoundException('This sign-in request expired — start the connection again from the AI app');
    return r;
  }

  /** What the consent screen shows. */
  async describeRequest(id: string) {
    const r = await this.request(id);
    const c = await this.client(r.clientId);
    if (!c) throw new NotFoundException('Unknown app');
    return { clientName: c.client_name, host: new URL(r.redirectUri).host, scope: OAUTH_SCOPE };
  }

  async decide(userId: string, id: string, approve: boolean): Promise<{ redirect: string }> {
    const r = await this.request(id);
    await this.put(`oq:${id}`, { ...r, done: true });
    if (!approve) return { redirect: withParams(r.redirectUri, { error: 'access_denied', error_description: 'The user declined', state: r.state }) };
    const c = await this.client(r.clientId);
    if (!c) throw new NotFoundException('Unknown app');
    const all = await this.grants(userId);
    const prev = all[c.client_id];
    all[c.client_id] = { name: c.client_name, host: new URL(r.redirectUri).host, gen: prev && !prev.revoked ? prev.gen : (prev?.gen ?? 0) + 1, createdAt: prev?.createdAt ?? new Date().toISOString(), lastUsedAt: prev?.lastUsedAt };
    await this.saveGrants(userId, all);
    const code = rnd(32);
    await this.put(`ocode:${sha(code)}`, { userId, clientId: c.client_id, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, gen: all[c.client_id].gen, exp: now() + CODE_TTL_MS });
    this.log.log(`user ${userId.slice(0, 3)}… approved "${c.client_name}"`);
    return { redirect: withParams(r.redirectUri, { code, state: r.state }) };
  }

  // ---------- token ----------
  private async authClient(body: any, basic?: string): Promise<OAuthClient> {
    let id = body?.client_id as string | undefined;
    let secret = body?.client_secret as string | undefined;
    if (basic?.startsWith('Basic ')) {
      const [u, p] = Buffer.from(basic.slice(6), 'base64').toString().split(':');
      id = decodeURIComponent(u ?? ''); secret = decodeURIComponent(p ?? '');
    }
    const c = await this.client(id);
    if (!c) throw new OAuthError('invalid_client', 'Unknown client', 401);
    if (c.secretHash) {
      const ok = !!secret && Buffer.from(sha(secret)).equals(Buffer.from(c.secretHash));
      if (!ok) throw new OAuthError('invalid_client', 'Bad client credentials', 401);
    }
    return c;
  }

  private async issue(userId: string, clientId: string, gen: number) {
    const access = `sea_${rnd(32)}`;
    const refresh = `ser_${rnd(32)}`;
    await this.put(`oat:${sha(access)}`, { userId, clientId, gen, exp: now() + ACCESS_TTL_S * 1000 });
    await this.put(`ort:${sha(refresh)}`, { userId, clientId, gen, exp: now() + REFRESH_TTL_MS });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: OAUTH_SCOPE };
  }

  private async grantLive(userId: string, clientId: string, gen: number) {
    const g = (await this.grants(userId))[clientId];
    return !!g && !g.revoked && g.gen === gen;
  }

  async token(body: any, basicAuth?: string) {
    const c = await this.authClient(body, basicAuth);
    if (body?.grant_type === 'authorization_code') {
      const key = `ocode:${sha(String(body.code ?? ''))}`;
      const code = await this.get<any>(key);
      if (!code || code.used || code.exp < now() || code.clientId !== c.client_id) throw new OAuthError('invalid_grant', 'Code is invalid, expired or already used');
      await this.put(key, { ...code, used: true });
      if (body.redirect_uri && body.redirect_uri !== code.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
      if (!pkceOk(body.code_verifier, code.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
      if (!(await this.grantLive(code.userId, c.client_id, code.gen))) throw new OAuthError('invalid_grant', 'Access was revoked');
      return this.issue(code.userId, c.client_id, code.gen);
    }
    if (body?.grant_type === 'refresh_token') {
      const key = `ort:${sha(String(body.refresh_token ?? ''))}`;
      const rt = await this.get<any>(key);
      if (!rt || rt.exp < now() || rt.clientId !== c.client_id) throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired');
      if (rt.used) {
        // Reuse of a rotated refresh token → assume theft, revoke this app's access.
        await this.revokeGrant(rt.userId, c.client_id);
        throw new OAuthError('invalid_grant', 'Refresh token reuse detected — access revoked');
      }
      await this.put(key, { ...rt, used: true });
      if (!(await this.grantLive(rt.userId, c.client_id, rt.gen))) throw new OAuthError('invalid_grant', 'Access was revoked');
      return this.issue(rt.userId, c.client_id, rt.gen);
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
  }

  /** RFC 7009: always 200; revokes the whole grant for that token's app. */
  async revokeToken(body: any, basicAuth?: string) {
    const c = await this.authClient(body, basicAuth).catch(() => null);
    const t = String(body?.token ?? '');
    const hit = (await this.get<any>(`oat:${sha(t)}`)) ?? (await this.get<any>(`ort:${sha(t)}`));
    if (c && hit && hit.clientId === c.client_id) await this.revokeGrant(hit.userId, c.client_id);
  }

  /** MCP resource check: a live access token → userId (and touches lastUsedAt at most every 10 min). */
  async userForAccessToken(token: string): Promise<string | null> {
    if (!token.startsWith('sea_')) return null;
    const t = await this.get<any>(`oat:${sha(token)}`);
    if (!t || t.exp < now()) return null;
    const all = await this.grants(t.userId);
    const g = all[t.clientId];
    if (!g || g.revoked || g.gen !== t.gen) return null;
    if (!g.lastUsedAt || now() - Date.parse(g.lastUsedAt) > 10 * 60_000) {
      g.lastUsedAt = new Date().toISOString();
      await this.saveGrants(t.userId, all).catch(() => undefined);
    }
    return t.userId;
  }

  // ---------- user-facing management ----------
  async listGrants(userId: string) {
    const all = await this.grants(userId);
    return Object.entries(all)
      .filter(([, g]) => !g.revoked)
      .map(([clientId, g]) => ({ clientId, name: g.name, host: g.host, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt ?? null }));
  }

  async revokeGrant(userId: string, clientId: string) {
    const all = await this.grants(userId);
    const g = all[clientId];
    if (!g) throw new ForbiddenException('No such connected app');
    all[clientId] = { ...g, revoked: true, gen: g.gen + 1 };
    await this.saveGrants(userId, all);
    this.log.log(`user ${userId.slice(0, 3)}… revoked "${g.name}"`);
    return { ok: true };
  }
}

export function withParams(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

