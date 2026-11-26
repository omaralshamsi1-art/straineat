import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { OAuthService, pkceOk, validRedirect } from '../src/mcp/oauth.service';
import { McpService } from '../src/mcp/mcp.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const BASE = 'https://straineat.example';
const CB = 'https://claude.ai/api/mcp/auth_callback';
const make = () => {
  const repo = new MemoryRepository();
  const oauth = new OAuthService(repo as any, new ConfigService({ PUBLIC_BASE_URL: BASE }));
  const mcp = new McpService(repo as any, {} as any, {} as any, {} as any, {} as any, {} as any, oauth);
  return { oauth, mcp };
};
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const codeFrom = (url: string) => new URL(url).searchParams.get('code')!;

async function connect(oauth: OAuthService, userId = 'u1') {
  const reg = await oauth.register({ client_name: 'Claude', redirect_uris: [CB], token_endpoint_auth_method: 'none' });
  const p = pkce();
  const start = await oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, redirect_uri: CB, code_challenge: p.challenge, code_challenge_method: 'S256', state: 'st1', scope: 'straineat' });
  const { redirect } = await oauth.decide(userId, start.requestId!, true);
  return { reg, p, redirect };
}

describe('OAuth for the MCP connector', () => {
  it('publishes RFC 9728 + RFC 8414 metadata pointing at this server', () => {
    const { oauth } = make();
    expect(oauth.resourceMetadata(BASE)).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
    const m = oauth.serverMetadata(BASE);
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it('validates redirect URIs and PKCE', () => {
    expect(validRedirect(CB)).toBe(true);
    expect(validRedirect('http://localhost:6274/cb')).toBe(true);
    expect(validRedirect('http://evil.com/cb')).toBe(false);
    expect(validRedirect('https://x.com/cb#frag')).toBe(false);
    const p = pkce();
    expect(pkceOk(p.verifier, p.challenge)).toBe(true);
    expect(pkceOk(pkce().verifier, p.challenge)).toBe(false);
    expect(pkceOk(undefined, p.challenge)).toBe(false);
  });

  it('full flow: register → consent → code → token → MCP user, with state echoed', async () => {
    const { oauth, mcp } = make();
    const { reg, p, redirect } = await connect(oauth);
    expect(redirect.startsWith(CB)).toBe(true);
    expect(new URL(redirect).searchParams.get('state')).toBe('st1');
    const tok = await oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code: codeFrom(redirect), redirect_uri: CB, code_verifier: p.verifier });
    expect(tok.token_type).toBe('Bearer');
    expect(await mcp.userFor(tok.access_token)).toBe('u1');
    expect(await oauth.listGrants('u1')).toEqual([expect.objectContaining({ clientId: reg.client_id, name: 'Claude', host: 'claude.ai' })]);
  });

  it('rejects code reuse, wrong verifier and unregistered redirect URIs', async () => {
    const { oauth } = make();
    const { reg, p, redirect } = await connect(oauth);
    const code = codeFrom(redirect);
    await expect(oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: pkce().verifier })).rejects.toThrow(/PKCE/);
    await expect(oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: p.verifier })).rejects.toThrow(/already used|invalid/);
    await expect(oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.com/cb', code_challenge: p.challenge, code_challenge_method: 'S256' })).rejects.toThrow(/redirect_uri/);
    const noPkce = await oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, redirect_uri: CB });
    expect(noPkce.redirect).toContain('error=invalid_request');
  });

  it('deny sends access_denied back to the app', async () => {
    const { oauth } = make();
    const reg = await oauth.register({ redirect_uris: [CB] });
    const start = await oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 'z' });
    const { redirect } = await oauth.decide('u1', start.requestId!, false);
    expect(new URL(redirect).searchParams.get('error')).toBe('access_denied');
    await expect(oauth.decide('u1', start.requestId!, true)).rejects.toThrow(/expired/);
  });

  it('refresh rotates tokens; reusing an old refresh token revokes the app', async () => {
    const { oauth, mcp } = make();
    const { reg, p, redirect } = await connect(oauth);
    const t1 = await oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code: codeFrom(redirect), code_verifier: p.verifier });
    const t2 = await oauth.token({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: t1.refresh_token });
    expect(await mcp.userFor(t2.access_token)).toBe('u1');
    await expect(oauth.token({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: t1.refresh_token })).rejects.toThrow(/reuse/);
    await expect(mcp.userFor(t2.access_token)).rejects.toThrow();
    expect(await oauth.listGrants('u1')).toEqual([]);
  });

  it('disconnecting in settings kills tokens immediately; reconnect works', async () => {
    const { oauth, mcp } = make();
    const { reg, p, redirect } = await connect(oauth);
    const t = await oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code: codeFrom(redirect), code_verifier: p.verifier });
    await oauth.revokeGrant('u1', reg.client_id);
    await expect(mcp.userFor(t.access_token)).rejects.toThrow();
    await expect(oauth.token({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: t.refresh_token })).rejects.toThrow(/revoked/);
    const p2 = pkce();
    const s2 = await oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, code_challenge: p2.challenge, code_challenge_method: 'S256' });
    const r2 = await oauth.decide('u1', s2.requestId!, true);
    const t2 = await oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code: codeFrom(r2.redirect), code_verifier: p2.verifier });
    expect(await mcp.userFor(t2.access_token)).toBe('u1');
  });

  it('confidential clients must present their secret; tokens are scoped to the approving user', async () => {
    const { oauth, mcp } = make();
    const reg: any = await oauth.register({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'client_secret_post' });
    expect(reg.client_secret).toBeTruthy();
    const p = pkce();
    const s = await oauth.startAuthorize({ response_type: 'code', client_id: reg.client_id, code_challenge: p.challenge, code_challenge_method: 'S256' });
    const { redirect } = await oauth.decide('u2', s.requestId!, true);
    await expect(oauth.token({ grant_type: 'authorization_code', client_id: reg.client_id, code: codeFrom(redirect), code_verifier: p.verifier })).rejects.toThrow(/credentials/);
    const basic = `Basic ${Buffer.from(`${reg.client_id}:${reg.client_secret}`).toString('base64')}`;
    const t = await oauth.token({ grant_type: 'authorization_code', code: codeFrom(redirect), code_verifier: p.verifier }, basic);
    expect(await mcp.userFor(t.access_token)).toBe('u2');
  });

  it('401 on the header endpoint advertises the resource metadata', async () => {
    const { mcp } = make();
    const r: any = { headers: {} as any, status(c: number) { this.code = c; return this; }, json() { return this; }, set(k: string, v: string) { this.headers[k] = v; return this; } };
    await mcp.handle({ headers: { host: 'x' } } as any, r);
    expect(r.code).toBe(401);
    expect(r.headers['WWW-Authenticate']).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });
});
