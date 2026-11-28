import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { bmiZone, caloriesHit, slopePerDay } from '../src/progress/progress.service';

describe('progress math', () => {
  it('slope of weigh-ins (kg/day)', () => {
    const pts = Array.from({ length: 15 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, kg: 80 - i * 0.1 }));
    expect(slopePerDay(pts)!).toBeCloseTo(-0.1, 5);
    expect(slopePerDay(pts.slice(0, 2))).toBeNull();
  });
  it('calorie band depends on the goal', () => {
    expect(caloriesHit('lose', 1500, 1800)).toBe(true);
    expect(caloriesHit('lose', 2000, 1800)).toBe(false);
    expect(caloriesHit('lose', 1000, 1800)).toBe(false);
    expect(caloriesHit('gain', 2600, 2500)).toBe(true);
    expect(caloriesHit('gain', 2200, 2500)).toBe(false);
  });
  it('BMI zones', () => {
    expect(bmiZone(18)).toBe('under'); expect(bmiZone(22)).toBe('normal'); expect(bmiZone(27)).toBe('over'); expect(bmiZone(31)).toBe('obese');
  });
});
