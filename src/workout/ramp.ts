// Target ramps around intervals (user's request 2026-09-24): during the 5 s before an
// interval starts and the 5 s after it ends, the target and band move linearly between
// the neighbouring segment's target and the interval's. The ramp lies in the
// neighbouring (non-interval) segment, so the interval keeps its full target. In a
// neighbour shorter than two ramps, each ramp gets half of it.
import { segmentIndexAt } from './expand';
import type { TimelineSegment } from './schema';

export const RAMP_S = 5;

export interface TargetPoint {
  targetW: number;
  lo: number;
  hi: number;
}

const point = (s: TimelineSegment): TargetPoint | null =>
  s.targetW !== null && s.lo !== null && s.hi !== null ? { targetW: s.targetW, lo: s.lo, hi: s.hi } : null;

const lerp = (a: TargetPoint, b: TargetPoint, f: number): TargetPoint => ({
  targetW: a.targetW + (b.targetW - a.targetW) * f,
  lo: a.lo + (b.lo - a.lo) * f,
  hi: a.hi + (b.hi - a.hi) * f,
});

/** Target and band at timeline time t, with ramps; null where there is no target. */
export function targetAt(timeline: readonly TimelineSegment[], t: number, rampS = RAMP_S): TargetPoint | null {
  const i = segmentIndexAt(timeline, t);
  const seg = timeline[i];
  if (!seg) return null;
  const here = point(seg);
  if (!here || seg.kind === 'interval' || rampS <= 0) return here;

  const r = Math.min(rampS, (seg.end - seg.start) / 2);
  const prev = timeline[i - 1];
  const next = timeline[i + 1];
  const prevPoint = prev && prev.kind === 'interval' ? point(prev) : null;
  const nextPoint = next && next.kind === 'interval' ? point(next) : null;
  if (prevPoint && t < seg.start + r) return lerp(prevPoint, here, (t - seg.start) / r);
  if (nextPoint && t > seg.end - r) return lerp(here, nextPoint, (t - (seg.end - r)) / r);
  return here;
}
