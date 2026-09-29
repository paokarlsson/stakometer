import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKOUTS } from '../src/workout/builtin';
import { expand } from '../src/workout/expand';
import { RAMP_S, targetAt } from '../src/workout/ramp';

const timeline = expand(BUILTIN_WORKOUTS.find((w) => w.id === '4x4-threshold')!, { cp: 200 }); // 210 W / rest 80 W

describe('targetAt (5 s ramps around intervals)', () => {
  it('keeps the interval at its full target from start to end', () => {
    expect(targetAt(timeline, 0)!.targetW).toBeCloseTo(210);
    expect(targetAt(timeline, 239.9)!.targetW).toBeCloseTo(210);
  });

  it('ramps down during the first 5 s of the rest after an interval', () => {
    expect(targetAt(timeline, 240)!.targetW).toBeCloseTo(210);
    expect(targetAt(timeline, 242.5)!.targetW).toBeCloseTo(145);
    expect(targetAt(timeline, 245)!.targetW).toBeCloseTo(80);
    expect(targetAt(timeline, 300)!.targetW).toBeCloseTo(80);
  });

  it('ramps up during the last 5 s of the rest before an interval, band included', () => {
    const mid = targetAt(timeline, 360 - RAMP_S / 2)!; // rest ends at 360
    expect(mid.targetW).toBeCloseTo(145);
    expect(mid.lo).toBeCloseTo((80 * 0.95 + 210 * 0.95) / 2);
    expect(mid.hi).toBeCloseTo((80 * 1.05 + 210 * 1.05) / 2);
    expect(targetAt(timeline, 360)!.targetW).toBeCloseTo(210);
  });

  it('splits a short rest between the two ramps (40/20)', () => {
    const t = expand(BUILTIN_WORKOUTS.find((w) => w.id === '3x10-40-20')!, { cp: 200 }); // 240 W / 20 s at 80 W
    expect(targetAt(t, 45)!.targetW).toBeCloseTo(80); // 40 + 5
    expect(targetAt(t, 50)!.targetW).toBeCloseTo(80);
    expect(targetAt(t, 57.5)!.targetW).toBeCloseTo(160);
    // A 6 s rest: ramps of 3 s each
    const short = [
      { start: 0, end: 10, kind: 'interval', label: '', targetW: 200, lo: 190, hi: 210, isMax: false },
      { start: 10, end: 16, kind: 'rest', label: '', targetW: 100, lo: 95, hi: 105, isMax: false },
      { start: 16, end: 26, kind: 'interval', label: '', targetW: 200, lo: 190, hi: 210, isMax: false },
    ];
    expect(targetAt(short, 13)!.targetW).toBeCloseTo(100);
    expect(targetAt(short, 11.5)!.targetW).toBeCloseTo(150);
    expect(targetAt(short, 14.5)!.targetW).toBeCloseTo(150);
  });

  it('has no ramp without a neighbouring interval or target', () => {
    const steady = expand(BUILTIN_WORKOUTS.find((w) => w.id === '30min-steady')!, { cp: 200 });
    expect(targetAt(steady, 1)!.targetW).toBeCloseTo(150);
    expect(targetAt(steady, 1800)).toBeNull();
    expect(targetAt(expand(BUILTIN_WORKOUTS[0]!, null), 242)).toBeNull();
  });
});
