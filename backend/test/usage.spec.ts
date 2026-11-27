import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { aiContext, AiUsageLog, kindForPath, usageDay } from '../src/usage/ai-usage';
import { AdminController } from '../src/controllers';

const est = {
  meal_name: 'Kabsa', meal_name_ar: 'كبسة', restaurant: null, source: 'estimate', confidence: 0.8, serving_description: '1 plate',
  items: [{ name: 'rice', name_ar: 'رز', quantity: 1, unit: 'plate', grams: 300, calories: 500, protein_g: 20, carbs_g: 70, fat_g: 15 }],
  sources: [], assumptions: [], warnings: [],
};
const reply = (status: number, data: any) => {
  const r: any = { ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
  r.clone = () => reply(status, data);
  return r;
};
const ok = (searches = 0) =>
  reply(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify(est) }] }, groundingMetadata: { webSearchQueries: Array.from({ length: searches }, (_, i) => `q${i}`) } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300, thoughtsTokenCount: 200 },
  });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('AI usage log', () => {
  it('maps endpoints to kinds', () => {
    expect(kindForPath('/meals/analyze')).toBe('photo');
    expect(kindForPath('/meals/analyze-text')).toBe('text');
    expect(kindForPath('/assistant/chat')).toBe('chat');
    expect(kindForPath('/water')).toBeNull();
  });

  it('counts every Gemini request per user, including the fallback after an overload', async () => {
    const repo = new MemoryRepository();
    const log = new AiUsageLog(repo as any);
    let n = 0;
    const fetchFn: any = vi.fn(async () => (++n === 1 ? reply(503, { error: 'high demand' }) : ok(2)));
    const agent = new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'k', GEMINI_GOOGLE_SEARCH: 'true' }), fetchFn, log);
    await aiContext.run({ userId: 'u1', kind: 'photo' }, () => agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] }));
    await aiContext.run({ userId: 'u2', kind: 'text' }, () => agent.analyze({ description: 'kabsa', known: [] }));
    await flush();
    const [today] = await log.days(1);
    expect(today.date).toBe(usageDay());
    const u1 = today.users.u1, u2 = today.users.u2;
    expect(fetchFn.mock.calls.length).toBe(3);
    expect(u1.photo).toBe(1); // one user action…
    expect(u1.req).toBe(2); // …but two Google requests
    expect(u1.fail).toBe(1);
    expect(u1.fallback).toBe(1);
    expect(u1.search).toBe(2);
    expect(u1.out).toBe(500); // thinking tokens are billed as output
    expect(u2.text).toBe(1);
    expect(u2.req).toBe(1);
    expect(u2.cost).toBeGreaterThan(0);
  });

  it('owner-only endpoint lists users with names; forget() removes a user', async () => {
    const repo = new MemoryRepository();
    const log = new AiUsageLog(repo as any);
    await repo.createUser({ id: 'u1', email: 'a@x.ae', name: 'Aisha', passwordHash: 'x', role: 'user', createdAt: new Date().toISOString() } as any);
    await log.record({ model: 'gemini-3.6-flash', ok: true, fallback: false, inTok: 100, outTok: 50, searches: 0 }, { userId: 'u1', kind: 'photo' });
    const admin = new AdminController(log, repo as any);
    await expect(admin.usage('user')).rejects.toThrow(/Owner/);
    const r = await admin.usage('owner', '7');
    expect(r.days).toHaveLength(7);
    expect(r.users[0]).toMatchObject({ id: 'u1', name: 'Aisha', email: 'a@x.ae' });
    expect(r.total.photo).toBe(1);
    await log.forget('u1');
    expect((await admin.usage('owner')).users).toHaveLength(0);
  });
});
