/** YYYY-MM-DD of an instant in an IANA timezone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-31, 2026-13-45
}

/** UTC instants of a local calendar day: [local midnight, next local midnight) — 23 or 25 h on DST-change days. */
export function dayBoundsUtc(date: string, timeZone: string): { start: Date; end: Date } {
  const next = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
  return { start: localMidnightUtc(date, timeZone), end: localMidnightUtc(next, timeZone) };
}

/** The UTC instant of 00:00 local time on `date` (offset taken at that instant, so DST days are exact). */
function localMidnightUtc(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  let t = guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60_000;
  t = guess.getTime() - tzOffsetMinutes(new Date(t), timeZone) * 60_000; // re-check with the offset in force then
  return new Date(t);
}

function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
