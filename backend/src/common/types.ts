/** Supported UI / AI languages. */
export type Lang = 'en' | 'ar';
export const DIET_STYLES = ['normal', 'vegetarian', 'vegan', 'keto', 'low_carb', 'mediterranean', 'paleo', 'light'] as const;
export type DietStyle = (typeof DIET_STYLES)[number];
export const CONDITIONS = ['hypertension', 'high_cholesterol', 'obesity', 'kidney', 'heart', 'thyroid', 'diabetes'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Conditions where diet changes should be supervised by a clinician. */
export const SUPERVISED_CONDITIONS: Condition[] = ['kidney', 'heart', 'diabetes', 'thyroid'];

export type NutritionSource =
  | 'restaurant_published' // official menu / restaurant nutrition page
  | 'known_meal' // user's own confirmed meal history
  | 'database' // generic food databases (USDA, etc.)
  | 'estimate'; // visual estimate by the agent

export interface Nutrients {
  calories: number; // kcal
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

export interface MealItem extends Nutrients {
  name: string;
  name_ar: string;
  quantity: number;
  unit: string; // "piece", "g", "cup", "serving"...
  grams: number | null;
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface NutritionEstimate {
  meal_name: string;
  meal_name_ar: string;
  restaurant: string | null;
  source: NutritionSource;
  confidence: number; // 0..1
  serving_description: string;
  items: MealItem[];
  totals: Nutrients;
  sources: SourceRef[];
  assumptions: string[];
  warnings: string[];
  /** coach (phase 2b): healthier alternatives and a short note, written by the agent */
  swaps?: { instead_of_ar: string; choose_ar: string; delta_kcal: number; delta_protein_g: number; why_ar: string }[];
  coach_note_ar?: string;
  /** meal | snack | drink — set by the user; otherwise guessed */
  kind?: 'meal' | 'snack' | 'drink';
}

export interface Meal {
  id: string;
  userId: string;
  eatenAt: string; // ISO
  date: string; // YYYY-MM-DD in user's tz
  status: 'draft' | 'confirmed';
  estimate: NutritionEstimate; // what the agent proposed
  final: NutritionEstimate; // after user edits (== estimate until edited)
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnownMeal {
  key: string; // normalized restaurant|name
  userId: string | null; // null = global (published values)
  restaurant: string | null;
  meal_name: string;
  meal_name_ar: string;
  source: NutritionSource;
  items: MealItem[];
  totals: Nutrients;
  sources: SourceRef[];
  timesLogged: number;
  updatedAt: string;
}

export type EnergySource =
  | 'apple_health'
  | 'whoop'
  | 'health_connect'
  | 'garmin'
  | 'fitbit'
  | 'manual'
  | 'estimate';

export interface EnergyDay {
  userId: string;
  date: string;
  source: EnergySource;
  activeKcal: number | null;
  basalKcal: number | null;
  totalKcal: number;
  updatedAt: string;
}

export interface Profile {
  userId: string;
  sex: 'male' | 'female' | null;
  birthYear: number | null;
  /** YYYY-MM-DD; when set, birthYear follows it */
  birthDate?: string | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'maintain' | 'gain';
  goalDeltaKcal: number; // e.g. -500 for lose, +300 for gain
  preferredEnergySource: EnergySource | null;
  timezone: string; // IANA, e.g. Asia/Dubai
  city: string | null;
  /** neighbourhood / area inside the city, used for restaurant suggestions */
  area?: string | null;
  country: string | null;
  // ---- goal engine (phase 2a) ----
  targetWeightKg: number | null;
  pace: 'relaxed' | 'moderate' | 'fast';
  startWeightKg: number | null;
  startDate: string | null;
  screening: { pregnant?: boolean; breastfeeding?: boolean; medicalSupervision?: boolean; edHistory?: boolean };
  onboarded: boolean;
  /** Set by the system when measured burn shows the declared activity level was off. */
  ramadan: { enabled: boolean | null; suhoorTime: string; iftarTime: string };
  reminders: { meals: boolean; weight: boolean };
  /** personal medicine / vitamin reminders (push at the set local times) */
  medReminders?: { id: string; name: string; dose: string; kind: 'medicine' | 'vitamin' | 'supplement' | 'other'; times: string[]; enabled: boolean }[];
  /** UI + AI output language */
  language: Lang;
  /** onboarding extras used by the plan and the AI coach */
  dietStyle?: DietStyle;
  conditions?: Condition[];
  mealsPerDay?: number | null;
  /** user-edited eating times; null/absent = automatic */
  mealSchedule?: { custom: boolean; slots: { id: string; kind: 'meal' | 'snack'; time: string }[] } | null;
  activityCalibration: {
    from: Profile['activityLevel'];
    to: Profile['activityLevel'];
    avgBurnKcal: number;
    days: number;
    factor: number;
    at: string; // YYYY-MM-DD
  } | null;
}

export interface WeightEntry {
  userId: string;
  date: string; // YYYY-MM-DD local
  kg: number;
  source: 'manual' | 'apple_health' | 'whoop';
  updatedAt: string;
}

export interface OAuthTokens {
  userId: string;
  provider: 'whoop';
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

export const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as (keyof Nutrients)[];

export interface Workout {
  userId: string;
  id: string; // `${source}:${externalId}`
  source: 'whoop' | 'apple_health' | 'health_connect' | 'manual';
  sport: string; // raw provider name, e.g. "running", "functional-fitness", "traditionalStrengthTraining"
  start: string; // ISO
  end: string; // ISO
  date: string; // local YYYY-MM-DD of start
  durationMin: number;
  kcal: number | null;
  strain: number | null; // WHOOP 0–21
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  zonesMin: number[] | null; // minutes in HR zones 0..5 (WHOOP)
  updatedAt: string;
}

export interface CacheEntry {
  userId: string;
  key: string;
  payload: unknown;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'owner' | 'user';
  createdAt: string;
}

export interface Invite {
  code: string;
  createdBy: string;
  usedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PushSub {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}
