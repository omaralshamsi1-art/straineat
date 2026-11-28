import { CacheEntry, EnergyDay, Invite, KnownMeal, Meal, OAuthTokens, Profile, PushSub, User, WeightEntry, Workout , WaterEntry } from '../common/types';
import { rankKnown, Repository } from './repository';

/** In-memory store for local development and tests. */
export class MemoryRepository implements Repository {
  private meals = new Map<string, Meal>();
  private known = new Map<string, KnownMeal>();
  private energy = new Map<string, EnergyDay>();
  private profiles = new Map<string, Profile>();
  private tokens = new Map<string, OAuthTokens>();
  private weights = new Map<string, WeightEntry>();
  private workouts = new Map<string, Workout>();
  private cache = new Map<string, CacheEntry>();
  private users = new Map<string, User>();
  private invites = new Map<string, Invite>();
  private pushSubs = new Map<string, PushSub>();
  private water = new Map<string, WaterEntry>();

  async saveMeal(m: Meal) {
    this.meals.set(m.id, structuredClone(m));
  }
  async getMeal(userId: string, id: string) {
    const m = this.meals.get(id);
    return m && m.userId === userId ? structuredClone(m) : null;
  }
  async listMeals(userId: string, date: string) {
    return [...this.meals.values()]
      .filter((m) => m.userId === userId && m.date === date)
      .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))
      .map((m) => structuredClone(m));
  }
  async listMealsRange(userId: string, from: string, to: string) {
    return [...this.meals.values()]
      .filter((m) => m.userId === userId && m.date >= from && m.date <= to)
      .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))
      .map((m) => structuredClone(m));
  }
  async deleteMeal(userId: string, id: string) {
    if (this.meals.get(id)?.userId === userId) this.meals.delete(id);
  }

  async findKnownCandidates(userId: string, restaurant: string | null, name: string | null) {
    const cands = [...this.known.values()].filter((k) => k.userId === null || k.userId === userId);
    return rankKnown(cands, restaurant, name);
  }
  async upsertKnown(k: KnownMeal) {
    this.known.set(`${k.userId ?? '*'}::${k.key}`, structuredClone(k));
  }
  async listUserKnown(userId: string, limit: number) {
    return [...this.known.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.timesLogged - a.timesLogged || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((k) => structuredClone(k));
  }
  /** test helper */
  async getKnown(userId: string | null, key: string) {
    return this.known.get(`${userId ?? '*'}::${key}`) ?? null;
  }

  async upsertEnergy(d: EnergyDay) {
    this.energy.set(`${d.userId}|${d.date}|${d.source}`, { ...d });
  }
  async listEnergy(userId: string, date: string) {
    return [...this.energy.values()].filter((d) => d.userId === userId && d.date === date);
  }

  async listEnergyRange(userId: string, from: string, to: string) {
    return [...this.energy.values()].filter((d) => d.userId === userId && d.date >= from && d.date <= to);
  }

  async upsertWater(e: WaterEntry) {
    this.water.set(`${e.userId}|${e.id}`, { ...e });
  }
  async listWater(userId: string, from: string, to: string) {
    return [...this.water.values()].filter((e) => e.userId === userId && e.date >= from && e.date <= to).sort((a, b) => a.at.localeCompare(b.at));
  }
  async deleteWater(userId: string, id: string) {
    return this.water.delete(`${userId}|${id}`);
  }

  async upsertWeight(w: WeightEntry) {
    this.weights.set(`${w.userId}|${w.date}|${w.source}`, { ...w });
  }
  async listWeights(userId: string, from: string, to: string) {
    return [...this.weights.values()]
      .filter((w) => w.userId === userId && w.date >= from && w.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  async deleteWeight(userId: string, date: string, source: WeightEntry['source']) {
    this.weights.delete(`${userId}|${date}|${source}`);
  }

  async upsertWorkout(w: Workout) {
    this.workouts.set(`${w.userId}|${w.id}`, { ...w });
  }
  async listWorkouts(userId: string, from: string, to: string) {
    return [...this.workouts.values()]
      .filter((w) => w.userId === userId && w.date >= from && w.date <= to)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  async deleteWorkout(userId: string, id: string) {
    this.workouts.delete(`${userId}|${id}`);
  }

  async getCache(userId: string, key: string) {
    return this.cache.get(`${userId}|${key}`) ?? null;
  }
  async setCache(e: CacheEntry) {
    this.cache.set(`${e.userId}|${e.key}`, structuredClone(e));
  }

  async incrCache(userId: string, key: string, delta: number) {
    const k = `${userId}|${key}`;
    const n = Number((this.cache.get(k)?.payload as { n?: number } | undefined)?.n ?? 0) + delta;
    this.cache.set(k, { userId, key, payload: { n }, createdAt: new Date().toISOString() });
    return n;
  }
  async purgeCache(prefixes: string[], before: string) {
    let n = 0;
    for (const [k, e] of this.cache) if (e.createdAt < before && prefixes.some((p) => e.key.startsWith(p))) { this.cache.delete(k); n++; }
    return n;
  }

  async createUser(u: User) {
    if ([...this.users.values()].some((x) => x.email === u.email) || this.users.has(u.id)) throw new Error('duplicate');
    this.users.set(u.id, { ...u });
  }
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async getUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createInvite(i: Invite) {
    this.invites.set(i.code, { ...i });
  }
  async getInvite(code: string) {
    return this.invites.get(code) ?? null;
  }
  async useInvite(code: string, userId: string, now: string) {
    const i = this.invites.get(code);
    if (!i || i.usedBy || i.expiresAt < now) return false;
    i.usedBy = userId;
    return true;
  }
  async listInvites(createdBy: string) {
    return [...this.invites.values()].filter((i) => i.createdBy === createdBy).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async savePushSub(s: PushSub) {
    this.pushSubs.set(s.endpoint, { ...s });
  }
  async deletePushSub(endpoint: string) {
    this.pushSubs.delete(endpoint);
  }
  async listPushSubs(userId?: string) {
    return [...this.pushSubs.values()].filter((s) => !userId || s.userId === userId);
  }

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.userId, { ...p });
  }

  async getTokens(userId: string, provider: 'whoop') {
    return this.tokens.get(`${userId}|${provider}`) ?? null;
  }
  async saveTokens(t: OAuthTokens) {
    this.tokens.set(`${t.userId}|${t.provider}`, { ...t });
  }
  async deleteTokens(userId: string, provider: 'whoop') {
    this.tokens.delete(`${userId}|${provider}`);
  }
  async deleteUserData(userId: string) {
    const out: Record<string, number> = {};
    const purge = <T>(name: string, m: Map<string, T>, owns: (v: T) => boolean) => {
      let n = 0;
      for (const [k, v] of m) if (owns(v)) { m.delete(k); n++; }
      out[name] = n;
    };
    purge('meals', this.meals, (v) => v.userId === userId);
    purge('known_meals', this.known, (v) => v.userId === userId);
    purge('energy_days', this.energy, (v) => v.userId === userId);
    purge('weights', this.weights, (v) => v.userId === userId);
    purge('workouts', this.workouts, (v) => v.userId === userId);
    purge('water_logs', this.water, (v) => v.userId === userId);
    purge('push_subs', this.pushSubs, (v) => v.userId === userId);
    purge('oauth_tokens', this.tokens, (v) => v.userId === userId);
    purge('coach_cache', this.cache, (v) => v.userId === userId || ((v.userId === '__lookup__' || v.userId === '__shortcut__') && (v.payload as any)?.userId === userId));
    purge('profiles', this.profiles, (v) => v.userId === userId);
    purge('invites', this.invites, (v) => v.createdBy === userId && !v.usedBy);
    purge('users', this.users, (v) => v.id === userId);
    return out;
  }
}
