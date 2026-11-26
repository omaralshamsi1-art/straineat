import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { McpService } from '../src/mcp/mcp.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const make = () => {
  const repo = new MemoryRepository();
  const svc = new McpService(repo as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { repo, svc };
};

describe('MCP connector token', () => {
  it('issues a stable secret token per user and resolves it back', async () => {
    const { svc } = make();
    const a = await svc.token('u1');
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect((await svc.token('u1')).token).toBe(a.token);
    expect(await svc.userFor(a.token)).toBe('u1');
    const b = await svc.token('u2');
    expect(b.token).not.toBe(a.token);
    expect(await svc.userFor(b.token)).toBe('u2');
  });

  it('rotation revokes the old link', async () => {
    const { svc } = make();
    const a = await svc.token('u1');
    const b = await svc.token('u1', true);
    expect(b.token).not.toBe(a.token);
    await expect(svc.userFor(a.token)).rejects.toThrow();
    expect(await svc.userFor(b.token)).toBe('u1');
  });

  it('rejects missing or unknown tokens', async () => {
    const { svc } = make();
    await expect(svc.userFor(undefined)).rejects.toThrow();
    await expect(svc.userFor('short')).rejects.toThrow();
    await expect(svc.userFor('x'.repeat(32))).rejects.toThrow();
  });

  it('answers 401 JSON-RPC for a bad token', async () => {
    const { svc } = make();
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await svc.handle({ headers: {} } as any, res, 'x'.repeat(32));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe(-32001);
  });
});

describe('MCP connector key transport + rate limit', () => {
  it('prefers the Authorization header, then X-Api-Key, then the link path', () => {
    expect(McpService.keyFrom({ headers: { authorization: 'Bearer abc123' } } as any, 'pathkey')).toBe('abc123');
    expect(McpService.keyFrom({ headers: { authorization: 'bearer   xyz' } } as any)).toBe('xyz');
    expect(McpService.keyFrom({ headers: { 'x-api-key': 'k1' } } as any)).toBe('k1');
    expect(McpService.keyFrom({ headers: {} } as any, 'pathkey')).toBe('pathkey');
    expect(McpService.keyFrom({ headers: { authorization: 'Basic zzz' } } as any)).toBeUndefined();
  });

  it('header key authenticates the same user as the link', async () => {
    const { svc } = make();
    const { token } = await svc.token('u9');
    expect(await svc.userFor(McpService.keyFrom({ headers: { authorization: `Bearer ${token}` } } as any))).toBe('u9');
  });

  it('limits each key per minute and recovers after the window', () => {
    const { svc } = make();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(svc.allow('k', 3, 60_000, t0 + i)).toBe(true);
    expect(svc.allow('k', 3, 60_000, t0 + 10)).toBe(false);
    expect(svc.allow('other', 3, 60_000, t0 + 10)).toBe(true);
    expect(svc.allow('k', 3, 60_000, t0 + 60_001)).toBe(true);
  });

  it('answers 429 when over the limit and 401 with no key', async () => {
    const { svc } = make();
    const mk = () => { const r: any = { status: vi.fn(() => r), json: vi.fn(() => r), set: vi.fn(() => r) }; return r; };
    for (let i = 0; i < 60; i++) svc.allow('y'.repeat(32));
    const r1 = mk(); await svc.handle({ headers: { authorization: `Bearer ${'y'.repeat(32)}` } } as any, r1);
    expect(r1.status).toHaveBeenCalledWith(429);
    const r2 = mk(); await svc.handle({ headers: {} } as any, r2);
    expect(r2.status).toHaveBeenCalledWith(401);
  });
});
