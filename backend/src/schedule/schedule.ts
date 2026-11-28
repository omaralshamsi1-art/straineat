/**
 * Meal kinds and the daily eating schedule (pure functions, unit-tested).
 * Kinds: a main meal, a snack, or a drink (coffee, tea, juice…). Drinks never "count" as a meal for the schedule.
 */
import { Meal, NutritionEstimate } from '../common/types';

export type MealKind = 'meal' | 'snack' | 'drink';
export const MEAL_KINDS: MealKind[] = ['meal', 'snack', 'drink'];

export type SlotId = 'breakfast' | 'lunch' | 'dinner' | 'snack1' | 'snack2' | 'snack3' | 'suhoor' | 'iftar' | 'evening';
export interface SlotDef {
  id: SlotId;
  kind: 'meal' | 'snack';
  time: string; // HH:MM local
}
export interface MealSchedule {
  custom: boolean;
  slots: SlotDef[];
}

const DRINK = [
  'coffee', 'latte', 'cappuccino', 'espresso', 'americano', 'mocha', 'macchiato', 'flat white', 'cortado', 'frappe', 'frappuccino', 'karak', 'chai',
  'tea', 'juice', 'smoothie', 'shake', 'milkshake', 'soda', 'cola', 'pepsi', 'coke', 'sprite', 'red bull', 'energy drink', 'milk', 'laban', 'lassi',
  'matcha', 'hot chocolate', 'mojito', 'lemonade', 'iced', 'water',
  'قهوة', 'قهوه', 'كوفي', 'لاتيه', 'لاتيه', 'كابتشينو', 'كابوتشينو', 'اسبريسو', 'إسبريسو', 'امريكانو', 'موكا', 'كرك', 'شاي', 'عصير',
  'سموذي', 'سموثي', 'ميلك شيك', 'شيك', 'حليب', 'لبن', 'مشروب', 'ماتشا', 'موهيتو', 'ليمونادة', 'ماء', 'كولا', 'بيبسي', 'ريد بل',
];
const FOODISH = [
  'sandwich', 'croissant', 'cake', 'cookie', 'muffin', 'burger', 'rice', 'bread', 'toast', 'oats', 'oatmeal', 'granola', 'cereal', 'salad',
  'egg', 'chicken', 'meat', 'beef', 'fish', 'pasta', 'pizza', 'wrap', 'bowl', 'yogurt', 'pancake', 'waffle', 'soup',
  'ساندويش', 'سندويش', 'كرواسون', 'كيك', 'خبز', 'توست', 'أرز', 'رز', 'برجر', 'شوفان', 'جرانولا', 'كورن فليكس', 'سلطة', 'بيض', 'دجاج',
  'لحم', 'سمك', 'معكرونة', 'باستا', 'بيتزا', 'راب', 'زبادي', 'بان كيك', 'شوربة', 'فول', 'حمص', 'شاورما',
];
const SNACK = ['bar', 'nuts', 'almond', 'fruit', 'apple', 'banana', 'dates', 'chips', 'biscuit', 'yogurt', 'popcorn', 'cookie', 'chocolate',
  'تمر', 'مكسرات', 'لوز', 'فاكهة', 'تفاح', 'موز', 'شيبس', 'بسكويت', 'زبادي', 'بوب كورن', 'شوكولاتة', 'بار',
  'kunafa', 'knafeh', 'dessert', 'ice cream', 'donut', 'brownie', 'كنافة', 'حلا', 'حلى', 'آيس كريم', 'دونات', 'لقيمات'];

/** Latin words match whole words (so "steak" is not "tea"); Arabic words match as substrings. */
const has = (text: string, words: string[]) =>
  words.some((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`(^|[^a-z])${w}s?($|[^a-z])`).test(text) : text.includes(w)));

/** Best guess of what was logged. The user can override it (stored as final.kind). */
export function classifyMeal(e: Pick<NutritionEstimate, 'meal_name' | 'meal_name_ar' | 'items' | 'totals'>): MealKind {
  const kcal = e.totals?.calories ?? 0;
  const name = `${e.meal_name ?? ''} ${e.meal_name_ar ?? ''}`.toLowerCase();
  const items = (e.items ?? []).map((i) => `${i.name ?? ''} ${i.name_ar ?? ''} ${i.unit ?? ''}`.toLowerCase());
  const itemIsDrink = (t: string) => has(t, DRINK) || /\bml\b|مل\b/.test(t);
  const foodish = has(name, FOODISH) || items.some((t) => has(t, FOODISH));
  const allDrinks = items.length ? items.every(itemIsDrink) : has(name, DRINK);
  if (allDrinks && !foodish && kcal < 600) return 'drink';
  if (kcal < 300 || (has(name, SNACK) && kcal < 400)) return 'snack';
  return 'meal';
}

export const kindOf = (m: Pick<Meal, 'final'>): MealKind => ((m.final as any).kind as MealKind) ?? classifyMeal(m.final);

export const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % 1440;
};
export const toHM = (min: number) => {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const round5 = (min: number) => Math.round(min / 15) * 15;

/** Default plan from meals per day and the user's learned meal times. */
export function defaultSchedule(mealsPerDay: number | null | undefined, usual: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>>): MealSchedule {
  const n = Math.min(Math.max(Math.round(mealsPerDay ?? 3), 1), 6);
  const b = usual.breakfast ?? 8 * 60, l = usual.lunch ?? 13 * 60 + 30, d = usual.dinner ?? 19 * 60 + 30;
  const slots: SlotDef[] = [];
  if (n === 1) slots.push({ id: 'lunch', kind: 'meal', time: toHM(round5(l)) });
  else if (n === 2) slots.push({ id: 'breakfast', kind: 'meal', time: toHM(round5((b + l) / 2)) }, { id: 'dinner', kind: 'meal', time: toHM(round5(d)) });
  else {
    slots.push({ id: 'breakfast', kind: 'meal', time: toHM(round5(b)) }, { id: 'lunch', kind: 'meal', time: toHM(round5(l)) }, { id: 'dinner', kind: 'meal', time: toHM(round5(d)) });
    if (n >= 4) slots.push({ id: 'snack2', kind: 'snack', time: toHM(round5((l + d) / 2)) });
    if (n >= 5) slots.push({ id: 'snack1', kind: 'snack', time: toHM(round5((b + l) / 2)) });
    if (n >= 6) slots.push({ id: 'snack3', kind: 'snack', time: toHM(round5(Math.min(d + 120, 22 * 60))) });
  }
  return { custom: false, slots: sortSlots(slots) };
}

export function ramadanSchedule(suhoorTime: string, iftarTime: string): MealSchedule {
  const i = toMin(iftarTime), s = toMin(suhoorTime);
  return {
    custom: false,
    slots: sortSlots([
      { id: 'iftar', kind: 'meal', time: toHM(i) },
      { id: 'evening', kind: 'snack', time: toHM(round5(i + 180)) },
      { id: 'suhoor', kind: 'meal', time: toHM(s - 45) },
    ]),
  };
}

export const sortSlots = (s: SlotDef[]) => [...s].sort((a, b) => toMin(a.time) - toMin(b.time));

/** Validate a user-edited schedule from the profile. */
export function validateSchedule(v: unknown): MealSchedule | null {
  if (v === null) return null;
  const raw = (v as any)?.slots;
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) throw new Error('schedule needs 1–8 slots');
  const ids: SlotId[] = ['breakfast', 'lunch', 'dinner', 'snack1', 'snack2', 'snack3'];
  const seen = new Set<string>();
  const slots = raw.map((x: any) => {
    if (!ids.includes(x?.id) || seen.has(x.id)) throw new Error('invalid slot id');
    seen.add(x.id);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.time))) throw new Error('time must be HH:MM');
    return { id: x.id as SlotId, kind: x.id.startsWith('snack') ? 'snack' : 'meal', time: String(x.time) } as SlotDef;
  });
  return { custom: true, slots: sortSlots(slots) };
}

/** kcal target per slot: snacks ~10% each, meals share the rest (lunch a bit bigger). */
export function slotTargets(slots: SlotDef[], targetKcal: number, ramadanSplit?: { suhoor: number; iftar: number; evening: number } | null) {
  const out: Record<string, number> = {};
  if (ramadanSplit && slots.some((s) => s.id === 'iftar')) {
    for (const s of slots) out[s.id] = (ramadanSplit as any)[s.id] ?? 0;
    return out;
  }
  const snacks = slots.filter((s) => s.kind === 'snack');
  const meals = slots.filter((s) => s.kind === 'meal');
  const snackKcal = Math.round((targetKcal * 0.1) / 10) * 10;
  const left = targetKcal - snackKcal * snacks.length;
  const w: Record<string, number> = { breakfast: 0.27, lunch: 0.38, dinner: 0.35 };
  const total = meals.reduce((a, s) => a + (w[s.id] ?? 0.33), 0) || 1;
  for (const s of snacks) out[s.id] = snackKcal;
  for (const s of meals) out[s.id] = Math.round((left * (w[s.id] ?? 0.33)) / total / 10) * 10;
  return out;
}

export type SlotStatus = 'done' | 'now' | 'upcoming' | 'missed' | 'skipped';
export interface SlotView extends SlotDef {
  targetKcal: number;
  /** the slot's fixed plan share (targetKcal is rebalanced for open slots) */
  planKcal?: number;
  status: SlotStatus;
  eatenKcal: number;
  items: { id: string; name: string; name_ar: string; kcal: number; kind: MealKind }[];
}

/**
 * Put today's confirmed meals into the slots: meals → nearest meal slot, snacks → nearest snack slot (within 3 h, else "extras");
 * drinks are listed apart and never mark a slot as done.
 */
export function buildDay(slots: SlotDef[], targets: Record<string, number>, meals: Meal[], nowMin: number, minuteOf: (m: Meal) => number, skipped: string[] = []) {
  const view: SlotView[] = slots.map((s) => ({ ...s, targetKcal: targets[s.id] ?? 0, status: 'upcoming', eatenKcal: 0, items: [] }));
  const drinks: SlotView['items'] = [];
  const extras: SlotView['items'] = []; // eaten far from any planned slot of that kind
  const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  for (const m of meals.filter((x) => x.status === 'confirmed')) {
    const kind = kindOf(m);
    const item = { id: m.id, name: m.final.meal_name, name_ar: m.final.meal_name_ar, kcal: Math.round(m.final.totals.calories), kind };
    if (kind === 'drink') { drinks.push(item); continue; }
    const at = minuteOf(m);
    const pool = view.filter((s) => s.kind === kind && dist(toMin(s.time), at) <= 180);
    if (!pool.length) { extras.push(item); continue; }
    const best = pool.reduce((a, s) => (dist(toMin(s.time), at) < dist(toMin(a.time), at) ? s : a));
    best.items.push(item);
    best.eatenKcal += item.kcal;
  }
  for (const s of view) {
    const t = toMin(s.time);
    s.status = s.items.length ? 'done' : skipped.includes(s.id) ? 'skipped' : nowMin < t - 15 ? 'upcoming' : nowMin <= t + 60 ? 'now' : 'missed';
  }
  return { slots: view, drinks, drinksKcal: drinks.reduce((a, d) => a + d.kcal, 0), extras };
}

export const SLOT_LABEL: Record<SlotId, { en: string; ar: string }> = {
  breakfast: { en: 'Breakfast', ar: 'الفطور' },
  lunch: { en: 'Lunch', ar: 'الغداء' },
  dinner: { en: 'Dinner', ar: 'العشاء' },
  snack1: { en: 'Morning snack', ar: 'سناك الصباح' },
  snack2: { en: 'Afternoon snack', ar: 'سناك العصر' },
  snack3: { en: 'Evening snack', ar: 'سناك المساء' },
  suhoor: { en: 'Suhoor', ar: 'السحور' },
  iftar: { en: 'Iftar', ar: 'الإفطار' },
  evening: { en: 'Evening meal', ar: 'وجبة المساء' },
};

/**
 * Slots still ahead share what's left of the day (same proportions as their plan share),
 * so "aim for about N kcal" never ignores what's already been eaten (capped at 1.5× the plan share). 0 = target reached.
 */
export function rebalanceOpenSlots(view: SlotView[], dayTarget: number, eatenKcal: number) {
  const open = view.filter((s) => s.status === 'upcoming' || s.status === 'now');
  const share = open.reduce((a, s) => a + s.targetKcal, 0);
  const left = Math.max(0, dayTarget - eatenKcal);
  for (const s of open) {
    s.planKcal = s.targetKcal;
    // never more than 1.5× the slot's plan share: skipped meals shouldn't pile onto one big dinner
    const fair = share > 0 ? left * (s.targetKcal / share) : 0;
    s.targetKcal = Math.round(Math.min(fair, s.targetKcal * 1.5) / 10) * 10;
  }
  return view;
}

/** Which schedule notifications are due now (sent once per slot per day by the caller). */
export function dueSlotReminders(view: SlotView[], nowMin: number, lang: 'en' | 'ar', opts: { fasting: boolean }) {
  const out: { key: string; title: string; body: string }[] = [];
  for (const s of view) {
    if (s.status === 'done' || s.status === 'skipped') continue;
    const t = toMin(s.time);
    const quiet = (nowMin >= 23 * 60 || nowMin < 7 * 60) && s.id !== 'suhoor';
    if (quiet) continue;
    if (opts.fasting && s.id !== 'iftar') continue;
    const name = SLOT_LABEL[s.id][lang];
    if (nowMin >= t - 10 && nowMin <= t + 4) {
      out.push(
        lang === 'ar'
          ? { key: `slot:${s.id}:before`, title: `${s.kind === 'snack' ? '🍎' : '🍽️'} وقت ${name}`, body: s.targetKcal > 0 ? `هدفك حوالي ${s.targetKcal} سعرة. افتح "ماذا آكل الآن؟" لاقتراحات جاهزة.` : 'وصلت هدفك اليوم — إذا جعت، خلّها خفيفة: خضار أو بروتين.' }
          : { key: `slot:${s.id}:before`, title: `${s.kind === 'snack' ? '🍎' : '🍽️'} ${name} time`, body: s.targetKcal > 0 ? `Aim for about ${s.targetKcal} kcal. Open "What should I eat now?" for ideas.` : "You've reached today's target — if you're hungry, keep it light: veg or protein." },
      );
    } else if (s.kind === 'meal' && nowMin >= t + 60 && nowMin <= t + 95) {
      out.push(
        lang === 'ar'
          ? { key: `slot:${s.id}:missed`, title: `لم تسجّل ${name} بعد`, body: 'صوّر وجبتك أو اختر من المفضلة بضغطة واحدة.' }
          : { key: `slot:${s.id}:missed`, title: `${name} not logged yet`, body: 'Snap your meal or pick a favourite in one tap.' },
      );
    }
  }
  return out;
}

type MainSlot = 'breakfast' | 'lunch' | 'dinner';
const MAIN_RANGE: Record<MainSlot, [number, number]> = { breakfast: [4 * 60, 11 * 60], lunch: [11 * 60, 16 * 60], dinner: [16 * 60, 23 * 60] };
const localMinutes = (iso: string | Date, tz: string) =>
  toMin(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));

/** Typical time (median, local minutes) per main meal, from real meals (not drinks/snacks) seen on ≥4 of the last 21 days. */
export function usualMealTimes(meals: Meal[], tz: string): Partial<Record<MainSlot, number>> {
  const per: Record<MainSlot, Map<string, number>> = { breakfast: new Map(), lunch: new Map(), dinner: new Map() };
  for (const m of meals) {
    if (m.status !== 'confirmed' || (m.final && kindOf(m) === 'drink')) continue;
    const min = localMinutes(m.eatenAt, tz);
    const s = (Object.keys(MAIN_RANGE) as MainSlot[]).find((k) => min >= MAIN_RANGE[k][0] && min < MAIN_RANGE[k][1]);
    if (s && !per[s].has(m.date)) per[s].set(m.date, min);
  }
  const out: Partial<Record<MainSlot, number>> = {};
  for (const s of Object.keys(per) as MainSlot[]) {
    const v = [...per[s].values()].sort((a, b) => a - b);
    if (v.length >= 4) out[s] = v[Math.floor(v.length / 2)];
  }
  return out;
}
