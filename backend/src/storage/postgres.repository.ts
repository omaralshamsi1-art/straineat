import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool, types } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);
import { CacheEntry, EnergyDay, Invite, KnownMeal, Meal, OAuthTokens, Profile, PushSub, User, WeightEntry, Workout , WaterEntry } from '../common/types';
import { normalizeKey } from '../common/nutrition-math';
import { rankKnown, Repository } from './repository';

/** Postgres / Supabase implementation. Schema: supabase/migrations/001_init.sql */
export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  static async fromUrl(url: string) {
    const repo = new PostgresRepository(new Pool({ connectionString: url, max: 10 }));
    await repo.migrate();
    return repo;
  }

  /** Applies supabase/migrations/*.sql once each (idempotent SQL; tracked in schema_migrations). */
  async migrate(dir = join(__dirname, '..', '..', 'supabase', 'migrations')) {
    await this.pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`);
    const done = new Set((await this.pool.query(`select name from schema_migrations`)).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await this.pool.query(readFileSync(join(dir, f), 'utf8'));
      await this.pool.query(`insert into schema_migrations (name) values ($1)`, [f]);
    }
  }

  async saveMeal(m: Meal) {
    await this.pool.query(
      `insert into meals (id, user_id, eaten_at, date, status, estimate, final, edited, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set eaten_at=$3, date=$4, status=$5, final=$7, edited=$8, updated_at=$10`,
      [m.id, m.userId, m.eatenAt, m.date, m.status, m.estimate, m.final, m.edited, m.createdAt, m.updatedAt],
    );
  }
  async getMeal(userId: string, id: string) {
    const r = await this.pool.query(`select * from meals where id=$1 and user_id=$2`, [id, userId]);
    return r.rows[0] ? rowToMeal(r.rows[0]) : null;
  }
  async listMeals(userId: string, date: string) {
    const r = await this.pool.query(`select * from meals where user_id=$1 and date=$2 order by eaten_at`, [userId, date]);
    return r.rows.map(rowToMeal);
  }
  async listMealsRange(userId: string, from: string, to: string) {
    const r = await this.pool.query(`select * from meals where user_id=$1 and date between $2 and $3 order by eaten_at`, [userId, from, to]);
    return r.rows.map(rowToMeal);
  }
  async deleteMeal(userId: string, id: string) {
    await this.pool.query(`delete from meals where id=$1 and user_id=$2`, [id, userId]);
  }

  async findKnownCandidates(userId: string, restaurant: string | null, name: string | null) {
    const [r, n] = normalizeKey(restaurant, name ?? '').split('|');
    // Trigram similarity narrows the candidate set; rankKnown does the final ordering.
    const res = await this.pool.query(
      `select * from known_meals
        where (user_id = $1 or user_id is null)
          and ( ($2 <> '' and similarity(split_part(key,'|',1), $2) > 0.3)
             or ($3 <> '' and similarity(split_part(key,'|',2), $3) > 0.3) )
        order by times_logged desc limit 40`,
      [userId, r, n],
    );
    return rankKnown(res.rows.map(rowToKnown), restaurant, name);
  }
  async upsertKnown(k: KnownMeal) {
    await this.pool.query(
      `insert into known_meals (key, user_id, restaurant, meal_name, meal_name_ar, source, items, totals, sources, times_logged, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (coalesce(user_id, '*'), key) do update set
         restaurant=$3, meal_name=$4, meal_name_ar=$5, source=$6, items=$7, totals=$8, sources=$9,
         times_logged=$10, updated_at=$11`,
      [
        k.key, k.userId, k.restaurant, k.meal_name, k.meal_name_ar, k.source,
        JSON.stringify(k.items), k.totals, JSON.stringify(k.sources), k.timesLogged, k.updatedAt,
      ],
    );
  }

  async listUserKnown(userId: string, limit: number) {
    const r = await this.pool.query(`select * from known_meals where user_id=$1 order by times_logged desc, updated_at desc limit $2`, [userId, limit]);
    return r.rows.map(rowToKnown);
  }

  async upsertEnergy(d: EnergyDay) {
    await this.pool.query(
      `insert into energy_days (user_id, date, source, active_kcal, basal_kcal, total_kcal, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_id, date, source) do update set active_kcal=$4, basal_kcal=$5, total_kcal=$6, updated_at=$7`,
      [d.userId, d.date, d.source, d.activeKcal, d.basalKcal, d.totalKcal, d.updatedAt],
    );
  }
  async listEnergy(userId: string, date: string) {
    return this.listEnergyRange(userId, date, date);
  }
  async listEnergyRange(userId: string, from: string, to: string) {
    const r = await this.pool.query(`select * from energy_days where user_id=$1 and date between $2 and $3`, [userId, from, to]);
    return r.rows.map((x) => ({
      userId: x.user_id,
      date: fmtDate(x.date),
      source: x.source,
      activeKcal: x.active_kcal == null ? null : Number(x.active_kcal),
      basalKcal: x.basal_kcal == null ? null : Number(x.basal_kcal),
      totalKcal: Number(x.total_kcal),
      updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }

  async upsertWater(e: WaterEntry) {
    await this.pool.query(
      `insert into water_logs (user_id, id, date, ml, source, at) values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, id) do update set date=$3, ml=$4, source=$5, at=$6`,
      [e.userId, e.id, e.date, e.ml, e.source, e.at],
    );
  }
  async listWater(userId: string, from: string, to: string) {
    const r = await this.pool.query(`select * from water_logs where user_id=$1 and date between $2 and $3 order by at`, [userId, from, to]);
    return r.rows.map((x) => ({ userId: x.user_id, id: x.id, date: fmtDate(x.date), ml: Number(x.ml), source: x.source, at: new Date(x.at).toISOString() }));
  }
  async deleteWater(userId: string, id: string) {
    const r = await this.pool.query(`delete from water_logs where user_id=$1 and id=$2`, [userId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async upsertWeight(w: WeightEntry) {
    await this.pool.query(
      `insert into weights (user_id, date, source, kg, updated_at) values ($1,$2,$3,$4,$5)
       on conflict (user_id, date, source) do update set kg=$4, updated_at=$5`,
      [w.userId, w.date, w.source, w.kg, w.updatedAt],
    );
  }
  async listWeights(userId: string, from: string, to: string) {
    const r = await this.pool.query(`select * from weights where user_id=$1 and date between $2 and $3 order by date`, [userId, from, to]);
    return r.rows.map((x) => ({
      userId: x.user_id,
      date: fmtDate(x.date),
      kg: Number(x.kg),
      source: x.source,
      updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }
  async deleteWeight(userId: string, date: string, source: WeightEntry['source']) {
    await this.pool.query(`delete from weights where user_id=$1 and date=$2 and source=$3`, [userId, date, source]);
  }

  async upsertWorkout(w: Workout) {
    await this.pool.query(
      `insert into workouts (user_id, id, source, sport, start_at, end_at, date, duration_min, kcal, strain, avg_hr, max_hr, distance_m, zones_min, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (user_id, id) do update set sport=$4, start_at=$5, end_at=$6, date=$7, duration_min=$8, kcal=$9, strain=$10,
         avg_hr=$11, max_hr=$12, distance_m=$13, zones_min=$14, updated_at=$15`,
      [w.userId, w.id, w.source, w.sport, w.start, w.end, w.date, w.durationMin, w.kcal, w.strain, w.avgHr, w.maxHr, w.distanceM,
        w.zonesMin ? JSON.stringify(w.zonesMin) : null, w.updatedAt],
    );
  }
  async listWorkouts(userId: string, from: string, to: string) {
    const r = await this.pool.query(`select * from workouts where user_id=$1 and date between $2 and $3 order by start_at`, [userId, from, to]);
    const n = (v: any) => (v == null ? null : Number(v));
    return r.rows.map((x): Workout => ({
      userId: x.user_id, id: x.id, source: x.source, sport: x.sport,
      start: new Date(x.start_at).toISOString(), end: new Date(x.end_at).toISOString(), date: fmtDate(x.date),
      durationMin: Number(x.duration_min), kcal: n(x.kcal), strain: n(x.strain), avgHr: n(x.avg_hr), maxHr: n(x.max_hr),
      distanceM: n(x.distance_m), zonesMin: x.zones_min ?? null, updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }
  async deleteWorkout(userId: string, id: string) {
    await this.pool.query(`delete from workouts where user_id=$1 and id=$2`, [userId, id]);
  }

  async getCache(userId: string, key: string): Promise<CacheEntry | null> {
    const r = await this.pool.query(`select * from coach_cache where user_id=$1 and key=$2`, [userId, key]);
    const x = r.rows[0];
    return x ? { userId, key, payload: x.payload, createdAt: new Date(x.created_at).toISOString() } : null;
  }
  async setCache(e: CacheEntry) {
    await this.pool.query(
      `insert into coach_cache (user_id, key, payload, created_at) values ($1,$2,$3,$4)
       on conflict (user_id, key) do update set payload=$3, created_at=$4`,
      [e.userId, e.key, JSON.stringify(e.payload), e.createdAt],
    );
  }

  async createUser(u: User) {
    await this.pool.query(
      `insert into users (id, email, name, password_hash, role, created_at) values ($1,$2,$3,$4,$5,$6)`,
      [u.id, u.email, u.name, u.passwordHash, u.role, u.createdAt],
    );
  }
  async getUserByEmail(email: string) {
    const r = await this.pool.query(`select * from users where email=$1`, [email]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async getUserById(id: string) {
    const r = await this.pool.query(`select * from users where id=$1`, [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  async createInvite(i: Invite) {
    await this.pool.query(`insert into invites (code, created_by, used_by, created_at, expires_at) values ($1,$2,$3,$4,$5)`, [
      i.code, i.createdBy, i.usedBy, i.createdAt, i.expiresAt,
    ]);
  }
  async getInvite(code: string) {
    const r = await this.pool.query(`select * from invites where code=$1`, [code]);
    return r.rows[0] ? rowToInvite(r.rows[0]) : null;
  }
  async useInvite(code: string, userId: string, now: string) {
    const r = await this.pool.query(`update invites set used_by=$2 where code=$1 and used_by is null and expires_at > $3`, [code, userId, now]);
    return (r.rowCount ?? 0) === 1;
  }
  async listInvites(createdBy: string) {
    const r = await this.pool.query(`select * from invites where created_by=$1 order by created_at desc limit 50`, [createdBy]);
    return r.rows.map(rowToInvite);
  }

  async savePushSub(s: PushSub) {
    await this.pool.query(
      `insert into push_subs (endpoint, user_id, keys, created_at) values ($1,$2,$3,$4)
       on conflict (endpoint) do update set user_id=$2, keys=$3`,
      [s.endpoint, s.userId, JSON.stringify(s.keys), s.createdAt],
    );
  }
  async deletePushSub(endpoint: string) {
    await this.pool.query(`delete from push_subs where endpoint=$1`, [endpoint]);
  }
  async listPushSubs(userId?: string) {
    const r = userId
      ? await this.pool.query(`select * from push_subs where user_id=$1`, [userId])
      : await this.pool.query(`select * from push_subs`);
    return r.rows.map((x) => ({ endpoint: x.endpoint, userId: x.user_id, keys: x.keys, createdAt: new Date(x.created_at).toISOString() }));
  }

  async getProfile(userId: string) {
    const r = await this.pool.query(`select data from profiles where user_id=$1`, [userId]);
    return r.rows[0] ? ({ ...r.rows[0].data, userId } as Profile) : null;
  }
  async saveProfile(p: Profile) {
    await this.pool.query(
      `insert into profiles (user_id, data, updated_at) values ($1,$2,now())
       on conflict (user_id) do update set data=$2, updated_at=now()`,
      [p.userId, p],
    );
  }

  async getTokens(userId: string, provider: 'whoop') {
    const r = await this.pool.query(`select * from oauth_tokens where user_id=$1 and provider=$2`, [userId, provider]);
    const x = r.rows[0];
    return x
      ? {
          userId,
          provider,
          accessToken: x.access_token,
          refreshToken: x.refresh_token,
          expiresAt: new Date(x.expires_at).toISOString(),
          scope: x.scope,
        }
      : null;
  }
  async saveTokens(t: OAuthTokens) {
    await this.pool.query(
      `insert into oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, provider) do update set access_token=$3, refresh_token=$4, expires_at=$5, scope=$6`,
      [t.userId, t.provider, t.accessToken, t.refreshToken, t.expiresAt, t.scope],
    );
  }
  async deleteTokens(userId: string, provider: 'whoop') {
    await this.pool.query(`delete from oauth_tokens where user_id=$1 and provider=$2`, [userId, provider]);
  }
}

const fmtDate = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

function rowToMeal(x: any): Meal {
  return {
    id: x.id,
    userId: x.user_id,
    eatenAt: new Date(x.eaten_at).toISOString(),
    date: fmtDate(x.date),
    status: x.status,
    estimate: x.estimate,
    final: x.final,
    edited: x.edited,
    createdAt: new Date(x.created_at).toISOString(),
    updatedAt: new Date(x.updated_at).toISOString(),
  };
}
function rowToKnown(x: any): KnownMeal {
  return {
    key: x.key,
    userId: x.user_id,
    restaurant: x.restaurant,
    meal_name: x.meal_name,
    meal_name_ar: x.meal_name_ar,
    source: x.source,
    items: x.items,
    totals: x.totals,
    sources: x.sources,
    timesLogged: x.times_logged,
    updatedAt: new Date(x.updated_at).toISOString(),
  };
}

function rowToUser(x: any): User {
  return { id: x.id, email: x.email, name: x.name, passwordHash: x.password_hash, role: x.role, createdAt: new Date(x.created_at).toISOString() };
}
function rowToInvite(x: any): Invite {
  return {
    code: x.code, createdBy: x.created_by, usedBy: x.used_by,
    createdAt: new Date(x.created_at).toISOString(), expiresAt: new Date(x.expires_at).toISOString(),
  };
}
