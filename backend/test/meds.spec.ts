import { describe, expect, it } from 'vitest';
import { dueMedReminders, validateMeds } from '../src/meds/meds';
import { validateProfilePatch } from '../src/profile/profile.service';

describe('medicine reminders', () => {
  it('validates, de-duplicates and sorts times', () => {
    const [m] = validateMeds([{ name: ' Vitamin D ', dose: '1000 IU', kind: 'vitamin', times: ['21:00', '08:00', '08:00'] }]);
    expect(m.name).toBe('Vitamin D');
    expect(m.times).toEqual(['08:00', '21:00']);
    expect(m.enabled).toBe(true);
    expect(() => validateMeds([{ name: 'x', times: ['8am'] }])).toThrow();
    expect(() => validateMeds([{ name: '', times: ['08:00'] }])).toThrow();
    expect(validateProfilePatch({ medReminders: [{ name: 'Pred', times: ['07:30'] }] } as any).medReminders![0].kind).toBe('medicine');
  });
  it('is due once in the 5-minute window at each time, in the user language', () => {
    const meds = validateMeds([{ id: 'p1', name: 'بريدنيزولون', dose: '5 ملغ', times: ['07:30'] }, { id: 'v', name: 'Omega 3', kind: 'supplement', times: ['07:30'], enabled: false }]);
    expect(dueMedReminders(meds, 7 * 60 + 29, 'ar')).toEqual([]);
    const d = dueMedReminders(meds, 7 * 60 + 32, 'ar');
    expect(d.map((x) => x.key)).toEqual(['med:p1:07:30']);
    expect(d[0].title).toContain('بريدنيزولون');
    expect(d[0].body).toContain('5 ملغ');
    expect(dueMedReminders(meds, 7 * 60 + 35, 'en')).toEqual([]);
    expect(dueMedReminders(meds, 7 * 60 + 30, 'en')[0].title).toContain('Time for');
  });
});
