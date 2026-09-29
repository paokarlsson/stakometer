import { describe, expect, it } from 'vitest';
import { BUILTIN_WORKOUTS } from '../src/workout/builtin';
import { calibrate, plannedMinWbal, scaleWork } from '../src/workout/calibrate';
import { expand } from '../src/workout/expand';

const sig = { pp: 430, cp: 180, wPrime: 10000 };
const timelineOf = (id: string) => expand(BUILTIN_WORKOUTS.find((w) => w.id === id)!, sig);

describe('plannedMinWbal', () => {
  it('follows the targets second by second', () => {
    // 8×1 min at 130 % CP = 234 W: 54 W over CP for 60 s drains 3 240 J per interval
    const min = plannedMinWbal(timelineOf('8x1-hard'), sig);
    expect(min.fraction).toBeLessThan(1 - 3240 / 10000 + 0.001);
    expect(min.t).toBe(timelineOf('8x1-hard').at(-1)!.end);
  });

  it('never drops for work at or below CP', () => {
    expect(plannedMinWbal(timelineOf('2x15-threshold'), sig).fraction).toBe(1);
  });
});

describe('scaleWork', () => {
  it('scales only the excess above CP and keeps the band relative', () => {
    const t = scaleWork(timelineOf('4x4-threshold'), 180, 0.5); // 189 W → 184.5 → 185
    expect(t[0]!.targetW).toBe(185);
    expect(t[0]!.lo! / t[0]!.targetW!).toBeCloseTo(0.95);
    expect(t[1]!.targetW).toBe(72); // rest unchanged
  });
});

describe('calibrate', () => {
  it('lowers a workout that would go below the minimum so it lands on it', () => {
    const c = calibrate(timelineOf('8x1-hard'), sig, { mode: 'lower', minFraction: 0.5 });
    expect(c.before.fraction).toBeLessThan(0.5);
    expect(c.scale).toBeLessThan(1);
    expect(c.minWbal.fraction).toBeGreaterThanOrEqual(0.49);
    expect(c.minWbal.fraction).toBeLessThan(0.52);
    expect(c.timeline[0]!.targetW).toBeLessThan(234);
  });

  it("'lower' leaves an easy workout alone, 'fit' raises it to land on the minimum", () => {
    const t = timelineOf('4x4-threshold'); // 189 W, barely over CP
    expect(calibrate(t, sig, { mode: 'lower', minFraction: 0.3 }).scale).toBe(1);
    const fit = calibrate(t, sig, { mode: 'fit', minFraction: 0.3 });
    expect(fit.scale).toBeGreaterThan(1);
    // Targets are whole watts; in 4×4 one watt is about 3 % of W′, so it lands up to one step above.
    expect(fit.minWbal.fraction).toBeGreaterThanOrEqual(0.3);
    expect(fit.minWbal.fraction).toBeLessThan(0.36);
  });

  it('never raises a target above PP', () => {
    const fit = calibrate(timelineOf('4x4-threshold'), { pp: 200, cp: 180, wPrime: 30000 }, { mode: 'fit', minFraction: 0.1 });
    expect(Math.max(...fit.timeline.map((s) => s.targetW ?? 0))).toBeLessThanOrEqual(200);
  });

  it('does nothing when off, or when no work is above CP', () => {
    expect(calibrate(timelineOf('8x1-hard'), sig, { mode: 'off', minFraction: 0.3 }).scale).toBe(1);
    expect(calibrate(timelineOf('30min-steady'), sig, { mode: 'fit', minFraction: 0.3 }).scale).toBe(1);
  });

  it('lands the 40/20 blocks on the minimum too', () => {
    const c = calibrate(timelineOf('3x10-40-20'), sig, { mode: 'fit', minFraction: 0.3 });
    expect(c.minWbal.fraction).toBeGreaterThanOrEqual(0.29);
    expect(c.minWbal.fraction).toBeLessThan(0.32);
  });
});
