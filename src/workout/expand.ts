// Workout → flat timeline (spec §6.2).
import type { SignatureParams } from '../model/signature';
import type { Target, TimelineSegment, Workout, WorkoutSegment } from './schema';

/** [FÖRSLAG] default band half-width (spec §6.1). */
export const DEFAULT_TOLERANCE = 0.05;

const KIND_LABEL: Record<string, string> = {
  warmup: 'Uppvärmning',
  interval: 'Intervall',
  rest: 'Vila',
  steady: 'Jämnt',
  cooldown: 'Nedvarvning',
  test: 'Test',
};

/**
 * Expands repeats (rest between repetitions, not after the last) and converts
 * targets to watts. With no signature, %CP targets become "no target".
 */
export function expand(workout: Workout, signature: Pick<SignatureParams, 'cp'> | null, defaultTolerance = DEFAULT_TOLERANCE): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  let t = 0;
  const add = (kind: string, label: string, duration: number, target: Target, tolerance: number): void => {
    const isMax = target !== null && 'max' in target;
    const targetW = toWatts(target, signature);
    out.push({
      start: t,
      end: t + duration,
      kind,
      label: isMax ? `${label} – MAX` : label,
      targetW,
      lo: targetW === null ? null : targetW * (1 - tolerance),
      hi: targetW === null ? null : targetW * (1 + tolerance),
      isMax,
    });
    t += duration;
  };

  for (const seg of workout.segments) {
    const reps = seg.repeat ?? 1;
    const label = KIND_LABEL[seg.kind] ?? seg.kind;
    for (let i = 1; i <= reps; i++) {
      add(seg.kind, reps > 1 ? `${label} ${i}/${reps}` : label, seg.duration, seg.target, tol(seg, defaultTolerance));
      if (seg.rest && i < reps) {
        add('rest', KIND_LABEL.rest!, seg.rest.duration, seg.rest.target, seg.rest.tolerance ?? defaultTolerance);
      }
    }
  }
  return out;
}

export function totalDuration(timeline: readonly TimelineSegment[]): number {
  return timeline.at(-1)?.end ?? 0;
}

/** Highest target in watts, or null when there are none. */
export function highestTarget(timeline: readonly TimelineSegment[]): number | null {
  const targets = timeline.map((s) => s.targetW).filter((w): w is number => w !== null);
  return targets.length > 0 ? Math.max(...targets) : null;
}

/** Index of the segment containing timeline time t (start inclusive), or -1 outside. */
export function segmentIndexAt(timeline: readonly TimelineSegment[], t: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = timeline[mid]!;
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

const tol = (seg: WorkoutSegment, fallback: number): number => seg.tolerance ?? fallback;

function toWatts(target: Target, signature: Pick<SignatureParams, 'cp'> | null): number | null {
  if (target === null || 'max' in target) return null;
  if ('watt' in target) return target.watt;
  return signature ? (signature.cp * target.pctCP) / 100 : null;
}
