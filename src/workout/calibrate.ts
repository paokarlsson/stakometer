// Fits a workout's intensity to the athlete so the planned W′ balance lands on a
// chosen minimum (user's request 2026-09-24). The plan is simulated second by
// second at the targets with the chosen W′ model. Only work above CP is scaled:
// target = CP + s · (target − CP). Rests and work at or below CP are unchanged.
import type { SignatureParams } from '../model/signature';
import { DEFAULT_WBAL, wbalStep, type WbalOptions } from '../model/wbal';
import { totalDuration } from './expand';
import { targetAt } from './ramp';
import type { TimelineSegment } from './schema';

export type CalibrationMode = 'off' | 'lower' | 'fit';

export interface Calibration {
  timeline: TimelineSegment[];
  /** Scale applied to the work above CP; 1 = unchanged. */
  scale: number;
  /** Planned lowest W′ as a fraction of W′ after calibration, and when (timeline s). */
  minWbal: { fraction: number; t: number };
  /** Planned lowest W′ before calibration. */
  before: { fraction: number; t: number };
}

/** Lowest planned W′ fraction, following the targets exactly, ramps included (no target = 0 W). */
export function plannedMinWbal(timeline: readonly TimelineSegment[], sig: SignatureParams, wbal: WbalOptions = DEFAULT_WBAL): { fraction: number; t: number } {
  let w = sig.wPrime;
  let min = { fraction: 1, t: 0 };
  const total = Math.ceil(totalDuration(timeline));
  for (let n = 1; n <= total; n++) {
    const p = targetAt(timeline, n - 0.5)?.targetW ?? 0;
    w = wbalStep(w, p, sig, 1, wbal);
    if (w / sig.wPrime < min.fraction) min = { fraction: w / sig.wPrime, t: n };
  }
  return min;
}

/** The timeline with the work above CP scaled by s, targets rounded to whole watts, bands kept relative. */
export function scaleWork(timeline: readonly TimelineSegment[], cp: number, s: number): TimelineSegment[] {
  return timeline.map((seg) => {
    if (seg.targetW === null || seg.targetW <= cp) return { ...seg };
    const targetW = Math.round(cp + s * (seg.targetW - cp));
    const ratio = targetW / seg.targetW;
    return { ...seg, targetW, lo: seg.lo === null ? null : seg.lo * ratio, hi: seg.hi === null ? null : seg.hi * ratio };
  });
}

/**
 * Scales the work above CP so the planned lowest W′ equals `minFraction`.
 * 'lower' only makes a workout easier when it would go below the minimum;
 * 'fit' also makes an easy one harder. Targets never go above PP.
 */
export function calibrate(
  timeline: readonly TimelineSegment[],
  sig: SignatureParams,
  opts: { mode: CalibrationMode; minFraction: number; wbal?: WbalOptions },
): Calibration {
  const wbal = opts.wbal ?? DEFAULT_WBAL;
  const minAt = (s: number) => plannedMinWbal(scaleWork(timeline, sig.cp, s), sig, wbal).fraction;
  const before = plannedMinWbal(timeline, sig, wbal);
  const unchanged = (): Calibration => ({ timeline: timeline.map((s) => ({ ...s })), scale: 1, minWbal: before, before });

  const excess = timeline.map((s) => (s.targetW ?? 0) - sig.cp).filter((e) => e > 0);
  if (opts.mode === 'off' || excess.length === 0) return unchanged();
  const tooHard = before.fraction < opts.minFraction;
  if (!tooHard && opts.mode === 'lower') return unchanged();

  // Largest scale that keeps every target at or below PP.
  const sMax = Math.min(...excess.map((e) => (sig.pp - sig.cp) / e));
  let lo: number;
  let hi: number;
  if (tooHard) {
    lo = 0; // at s = 0 all work is at CP: W′ never drops
    hi = 1;
  } else {
    if (sMax <= 1) return unchanged();
    if (minAt(sMax) >= opts.minFraction) {
      const timelineMax = scaleWork(timeline, sig.cp, sMax);
      return { timeline: timelineMax, scale: sMax, minWbal: plannedMinWbal(timelineMax, sig, wbal), before };
    }
    lo = 1;
    hi = sMax;
  }
  // The lowest W′ falls as s grows: bisect for the largest s that stays at or above the minimum.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (minAt(mid) >= opts.minFraction) lo = mid;
    else hi = mid;
  }
  const result = scaleWork(timeline, sig.cp, lo);
  return { timeline: result, scale: lo, minWbal: plannedMinWbal(result, sig, wbal), before };
}
