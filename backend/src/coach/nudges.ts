/**
 * "Essential" notifications (pure; unit-tested): activity logged, calorie target 90/100/115 %,
 * evening protein gap, weekly summary (Sunday evening), goal-journey milestones.
 * Quiet hours and the daily cap are applied by the caller (RemindersService).
 */
export type Nudge = { key: string; title: string; body: string };
type Lang = 'ar' | 'en' | string;
const ar = (l: Lang) => l === 'ar';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Max non-medicine notifications per user per day. */
export const DAILY_CAP = 6;
/** Medicine reminders are never capped or skipped. */
export const isUncapped = (key: string) => key.startsWith('med:');
/** Keys the iOS app already schedules locally (so APNs must not repeat them). */
export const isLocalOnIos = (key: string) => key.startsWith('slot:') || key.startsWith('meal:') || key.startsWith('water:') || key.startsWith('med:');

export const MIN_ACTIVITY_MIN = 10;

/** One note per new activity (≥10 min), within 3 h of its end (manual entries: within 30 min of being added). */
export function activityNudges(i: {
  now: Date;
  workouts: { id: string; sportAr?: string; sportEn?: string; end: string; durationMin: number; kcal: number | null; source?: string; updatedAt?: string }[];
  remainingKcal: number | null;
  fasting: boolean;
  lang: Lang;
}): Nudge[] {
  const t = i.now.getTime();
  const out: Nudge[] = [];
  for (const w of i.workouts) {
    if (w.durationMin < MIN_ACTIVITY_MIN) continue;
    const end = Date.parse(w.end);
    const added = w.updatedAt ? Date.parse(w.updatedAt) : NaN;
    const fresh = (Number.isFinite(end) && end <= t && t - end <= 180 * 60000) || (w.source === 'manual' && Number.isFinite(added) && t - added >= 0 && t - added <= 30 * 60000);
    if (!fresh) continue;
    const name = (ar(i.lang) ? w.sportAr : w.sportEn) || (ar(i.lang) ? 'نشاط' : 'Activity');
    const kcal = w.kcal != null && w.kcal > 0 ? Math.round(w.kcal) : null;
    const title = ar(i.lang)
      ? `${name} · ${kcal != null ? `${fmt(kcal)} سعرة` : `${Math.round(w.durationMin)} دقيقة`} 🔥`
      : `${name} · ${kcal != null ? `${fmt(kcal)} kcal` : `${Math.round(w.durationMin)} min`} 🔥`;
    let body: string;
    if (i.remainingKcal == null || i.fasting) body = ar(i.lang) ? 'سجّلنا نشاطك — عافية! اشرب ماء وتابع يومك.' : 'Activity logged — nice work. Drink some water and keep going.';
    else if (i.remainingKcal > 0) body = ar(i.lang) ? `صار باقي لك اليوم ${fmt(i.remainingKcal)} سعرة.` : `You have ${fmt(i.remainingKcal)} kcal left today.`;
    else body = ar(i.lang) ? 'وصلت هدف سعراتك اليوم — النشاط يساعدك تبقى ضمنه.' : "You've reached today's calorie target — this helps you stay on track.";
    out.push({ key: `wo:${w.id}`, title, body });
  }
  return out;
}

export const KCAL_STAGES = ['kcal:90', 'kcal:100', 'kcal:115'] as const;

/** Highest calorie stage reached today (only that one is sent; lower stages are marked done by the caller). */
export function calorieNudge(i: { eatenKcal: number; targetKcal: number; goal: 'lose' | 'maintain' | 'gain'; fasting: boolean; lang: Lang }): Nudge | null {
  if (!(i.targetKcal > 0) || i.fasting) return null;
  const pct = i.eatenKcal / i.targetKcal;
  const left = Math.round(i.targetKcal - i.eatenKcal);
  const A = ar(i.lang);
  if (pct >= 1.15 && i.goal !== 'gain')
    return A
      ? { key: 'kcal:115', title: 'عديت هدفك اليوم شوي', body: `أكلت ${fmt(i.eatenKcal)} من ${fmt(i.targetKcal)} سعرة. عادي يصير — بكرة يوم جديد، والمشي بعد الأكل يساعد.` }
      : { key: 'kcal:115', title: 'A bit over target today', body: `${fmt(i.eatenKcal)} of ${fmt(i.targetKcal)} kcal. It happens — tomorrow is a new day, and a walk after eating helps.` };
  if (pct >= 1)
    return A
      ? { key: 'kcal:100', title: 'وصلت هدفك اليوم ✅', body: i.goal === 'gain' ? `${fmt(i.eatenKcal)} سعرة — ممتاز، هذا اللي يحتاجه جسمك للزيادة.` : `${fmt(i.eatenKcal)} من ${fmt(i.targetKcal)} سعرة. إذا جعت، خلك على خضار أو بروتين خفيف.` }
      : { key: 'kcal:100', title: 'Target reached today ✅', body: i.goal === 'gain' ? `${fmt(i.eatenKcal)} kcal — exactly what your body needs to gain.` : `${fmt(i.eatenKcal)} of ${fmt(i.targetKcal)} kcal. If you're hungry, stick to veg or light protein.` };
  if (pct >= 0.9)
    return A
      ? { key: 'kcal:90', title: `باقي لك ${fmt(left)} سعرة بس`, body: i.goal === 'gain' ? 'قربت من هدفك — وجبة خفيفة تكمّله.' : 'قربت من هدفك — خل الوجبة الجاية خفيفة.' }
      : { key: 'kcal:90', title: `Only ${fmt(left)} kcal left`, body: i.goal === 'gain' ? "You're close — a snack will finish it." : "You're close — keep the next meal light." };
  return null;
}

/** 19:00–20:30, at least one meal logged, protein under 70 % of target. */
export function proteinNudge(i: { nowMin: number; proteinG: number; targetG: number; mealsToday: number; fasting: boolean; lang: Lang }): Nudge | null {
  if (i.fasting || !(i.targetG > 0) || i.mealsToday < 1) return null;
  if (i.nowMin < 19 * 60 || i.nowMin > 20 * 60 + 30) return null;
  if (i.proteinG >= i.targetG * 0.7) return null;
  const gap = Math.round(i.targetG - i.proteinG);
  const idea = ar(i.lang)
    ? gap >= 40 ? 'صدر دجاج أو سمك (حوالي 35–40 غ)' : gap >= 20 ? 'تونة أو 3 بيضات (حوالي 20 غ)' : 'زبادي يوناني (حوالي 15 غ)'
    : gap >= 40 ? 'chicken breast or fish (~35–40 g)' : gap >= 20 ? 'tuna or 3 eggs (~20 g)' : 'Greek yoghurt (~15 g)';
  return ar(i.lang)
    ? { key: 'protein', title: `ناقصك ${gap} غ بروتين 💪`, body: `اقتراح للعشا: ${idea}.` }
    : { key: 'protein', title: `${gap} g protein to go 💪`, body: `Dinner idea: ${idea}.` };
}

/** Sunday 20:00–21:30 local: the week's habit score. */
export function weeklyNudge(i: { weekday: number; nowMin: number; week: { score: number; lastWeekScore: number | null; delta: number | null; weakest?: { habit: string } | null } | null; lang: Lang }): Nudge | null {
  if (i.weekday !== 0 || i.nowMin < 20 * 60 || i.nowMin > 21 * 60 + 30 || !i.week) return null;
  const w = i.week;
  const A = ar(i.lang);
  const names: Record<string, [string, string]> = { calories: ['السعرات', 'calories'], protein: ['البروتين', 'protein'], water: ['الماء', 'water'], steps: ['الخطوات', 'steps'], logged: ['الوجبات', 'meals'] };
  const trend = w.delta == null ? '' : w.delta > 0 ? (A ? ` (+${w.delta} عن الأسبوع اللي فات)` : ` (+${w.delta} vs last week)`) : w.delta < 0 ? (A ? ` (${w.delta} عن الأسبوع اللي فات)` : ` (${w.delta} vs last week)`) : A ? ' (نفس الأسبوع اللي فات)' : ' (same as last week)';
  const weak = w.weakest?.habit && names[w.weakest.habit] ? (A ? ` ركّز الأسبوع الجاي على ${names[w.weakest.habit][0]}.` : ` Next week, focus on ${names[w.weakest.habit][1]}.`) : '';
  return A
    ? { key: 'week', title: `التزام الأسبوع: ${w.score}/100 📅`, body: `نتيجتك${trend}.${weak}` }
    : { key: 'week', title: `Week score: ${w.score}/100 📅`, body: `Your result${trend}.${weak}` };
}

/** Journey level 0–4 (quarters of the way; 4 = reached). */
export const journeyLevel = (frac: number) => Math.max(0, Math.min(4, Math.floor(frac * 4 + 1e-9)));

/** A note when the journey reaches a new quarter (first sighting only records the level). */
export function milestoneNudge(i: { level: number; prevLevel: number | null; targetKg: number; currentKg: number; lang: Lang }): Nudge | null {
  if (i.prevLevel == null || i.level <= i.prevLevel || i.level < 1) return null;
  const A = ar(i.lang);
  if (i.level >= 4)
    return A
      ? { key: 'goal:reached', title: 'وصلت لوزنك المستهدف 🎉', body: `${i.currentKg} كغ — مبروك! افتح «التقدم» عشان تحدد خطوتك الجاية.` }
      : { key: 'goal:reached', title: 'You reached your goal weight 🎉', body: `${i.currentKg} kg — congratulations! Open Progress to set your next step.` };
  const pct = i.level * 25;
  return A
    ? { key: `goal:${i.level}`, title: `قطعت ${pct}% من رحلتك 🏁`, body: `وزنك الحين ${i.currentKg} كغ، وهدفك ${i.targetKg} كغ. كمّل!` }
    : { key: `goal:${i.level}`, title: `${pct}% of your journey done 🏁`, body: `You're at ${i.currentKg} kg, heading for ${i.targetKg} kg. Keep going!` };
}
