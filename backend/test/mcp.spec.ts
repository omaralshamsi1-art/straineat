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
    await svc.handle({} as any, res, 'x'.repeat(32));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error.code).toBe(-32001);
  });
});
