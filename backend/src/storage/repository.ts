import { CacheEntry, WaterEntry, EnergyDay, Invite, KnownMeal, Meal, OAuthTokens, Profile, PushSub, User, WeightEntry, Workout } from '../common/types';
import { normalizeKey } from '../common/nutrition-math';

export const REPOSITORY = Symbol('REPOSITORY');

export interface Repository {
  saveMeal(meal: Meal): Promise<void>;
  getMeal(userId: string, id: string): Promise<Meal | null>;
  listMeals(userId: string, date: string): Promise<Meal[]>;
  /** inclusive date range */
  listMealsRange(userId: string, from: string, to: string): Promise<Meal[]>;
  deleteMeal(userId: string, id: string): Promise<void>;

  /** Candidates for the agent's "experience": user's own + global published meals. */
  findKnownCandidates(userId: string, restaurant: string | null, name: string | null): Promise<KnownMeal[]>;
  upsertKnown(meal: KnownMeal): Promise<void>;
  /** user's own known meals, most logged first */
  listUserKnown(userId: string, limit: number): Promise<KnownMeal[]>;

  upsertEnergy(day: EnergyDay): Promise<void>;
  listEnergy(userId: string, date: string): Promise<EnergyDay[]>;
  listEnergyRange(userId: string, from: string, to: string): Promise<EnergyDay[]>;

  upsertWeight(w: WeightEntry): Promise<void>;
  listWeights(userId: string, from: string, to: string): Promise<WeightEntry[]>;
  deleteWeight(userId: string, date: string, source: WeightEntry['source']): Promise<void>;

  upsertWorkout(w: Workout): Promise<void>;
  listWorkouts(userId: string, from: string, to: string): Promise<Workout[]>;
  deleteWorkout(userId: string, id: string): Promise<void>;

  upsertWater(e: WaterEntry): Promise<void>;
  listWater(userId: string, from: string, to: string): Promise<WaterEntry[]>;
  deleteWater(userId: string, id: string): Promise<boolean>;

  getCache(userId: string, key: string): Promise<CacheEntry | null>;
  setCache(e: CacheEntry): Promise<void>;

  createUser(u: User): Promise<void>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  createInvite(i: Invite): Promise<void>;
  getInvite(code: string): Promise<Invite | null>;
  /** atomically marks an unused, unexpired invite as used; returns false if it was not available */
  useInvite(code: string, userId: string, now: string): Promise<boolean>;
  listInvites(createdBy: string): Promise<Invite[]>;

  savePushSub(s: PushSub): Promise<void>;
  deletePushSub(endpoint: string): Promise<void>;
  listPushSubs(userId?: string): Promise<PushSub[]>;

  getProfile(userId: string): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;

  getTokens(userId: string, provider: 'whoop'): Promise<OAuthTokens | null>;
  saveTokens(t: OAuthTokens): Promise<void>;
  deleteTokens(userId: string, provider: 'whoop'): Promise<void>;
}

/** Ranks known meals by token overlap with the requested restaurant + name. */
export function rankKnown(cands: KnownMeal[], restaurant: string | null, name: string | null, limit = 5): KnownMeal[] {
  const [qr, qn] = normalizeKey(restaurant, name ?? '').split('|');
  const toks = (s: string) => new Set(s.split(' ').filter(Boolean));
  const qrT = toks(qr);
  const qnT = toks(qn);
  const overlap = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n / Math.max(a.size, b.size);
  };
  return cands
    .map((k) => {
      const [kr, kn] = k.key.split('|');
      const score =
        (qrT.size ? overlap(qrT, toks(kr)) * 2 : 0) +
        (qnT.size ? overlap(qnT, toks(kn)) * 3 : 0) +
        Math.min(k.timesLogged, 10) * 0.02 +
        (k.userId ? 0.1 : 0); // prefer the user's own corrections
      return { k, score };
    })
    .filter((x) => x.score >= 0.5 || (!qrT.size && !qnT.size && x.k.userId))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.k);
}
