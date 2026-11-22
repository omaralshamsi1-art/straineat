import { BadRequestException } from '@nestjs/common';

/** A personal medicine / vitamin / supplement reminder. Reminders only — no dosing advice. */
export interface MedReminder {
  id: string;
  name: string;
  dose: string;
  kind: 'medicine' | 'vitamin' | 'supplement' | 'other';
  times: string[]; // "HH:MM", local time, 1–6 per item
  enabled: boolean;
}

const KINDS = ['medicine', 'vitamin', 'supplement', 'other'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function validateMeds(v: unknown): MedReminder[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new BadRequestException('medReminders must be a list');
  if (v.length > 20) throw new BadRequestException('At most 20 reminders');
  const ids = new Set<string>();
  return v.map((raw: any, i) => {
    const name = String(raw?.name ?? '').trim().slice(0, 60);
    if (!name) throw new BadRequestException('Each reminder needs a name');
    const times = [...new Set((Array.isArray(raw?.times) ? raw.times : []).map((x: any) => String(x).trim()))] as string[];
    if (!times.length || times.length > 6 || times.some((x) => !HHMM.test(x))) throw new BadRequestException('Reminder times must be 1–6 values like 08:00');
    let id = String(raw?.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || `m${Date.now().toString(36)}${i}`;
    while (ids.has(id)) id += 'x';
    ids.add(id);
    const kind = (KINDS as readonly string[]).includes(raw?.kind) ? raw.kind : 'medicine';
    return { id, name, dose: String(raw?.dose ?? '').trim().slice(0, 40), kind, times: times.sort((a, b) => toMin(a) - toMin(b)), enabled: raw?.enabled !== false };
  });
}

/** Reminders due in the 5-minute window starting at each set time (the scheduler runs every 5 minutes). */
export function dueMedReminders(meds: MedReminder[], nowMin: number, lang: 'en' | 'ar') {
  const out: { key: string; title: string; body: string }[] = [];
  for (const m of meds) {
    if (!m.enabled) continue;
    for (const tm of m.times) {
      const t = toMin(tm);
      if (nowMin < t || nowMin >= t + 5) continue;
      const icon = m.kind === 'vitamin' || m.kind === 'supplement' ? '🌿' : '💊';
      out.push(
        lang === 'ar'
          ? { key: `med:${m.id}:${tm}`, title: `${icon} وقت ${m.name}`, body: `${m.dose ? `${m.dose} · ` : ''}موعدك الساعة ${tm}.` }
          : { key: `med:${m.id}:${tm}`, title: `${icon} Time for ${m.name}`, body: `${m.dose ? `${m.dose} · ` : ''}Scheduled for ${tm}.` },
      );
    }
  }
  return out;
}
