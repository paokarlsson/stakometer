// Workout → flat timeline (spec §6.2).
import type { SignatureParams } from '../model/signature';
import type { RestSpec, Target, TimelineSegment, Workout, WorkoutSegment, WorkoutStep } from './schema';

/** [FÖRSLAG] default band half-width (spec §6.1). */
export const DEFAULT_TOLERANCE = 0.05;

export const KIND_LABEL: Record<string, string> = {
  warmup: 'Uppvärmning',
  interval: 'Intervall',
  rest: 'Vila',
  steady: 'Jämnt',
  cooldown: 'Nedvarvning',
  test: 'Test',
};

/** Name of a block without a label, shown only when it repeats. */
export const BLOCK_LABEL = 'Block';

/** Where a step sits: the enclosing blocks' labels and the nearest block description. */
interface Context {
  block?: string;
  description?: string;
}

/**
 * Expands repeats (rest between repetitions, not after the last) and blocks, and
 * converts targets to watts. With no signature, %CP targets become "no target".
 */
export function expand(workout: Workout, signature: Pick<SignatureParams, 'cp'> | null, defaultTolerance = DEFAULT_TOLERANCE): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  let t = 0;
  const add = (kind: string, label: string, duration: number, target: Target, tolerance: number, ctx: Context): void => {
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
      ...(ctx.block !== undefined && { block: ctx.block }),
      ...(ctx.description !== undefined && { description: ctx.description }),
    });
    t += duration;
  };
  // A rest belongs to the context around the repeated step, not to the step itself.
  const addRest = (rest: RestSpec, ctx: Context): void =>
    add('rest', KIND_LABEL.rest!, rest.duration, rest.target, rest.tolerance ?? defaultTolerance, withDescription(ctx, rest.description));

  const walk = (steps: readonly WorkoutStep[], ctx: Context): void => {
    for (const step of steps) {
      const reps = step.repeat ?? 1;
      if (step.kind === 'block') {
        const name = step.label ?? (reps > 1 ? BLOCK_LABEL : undefined);
        for (let i = 1; i <= reps; i++) {
          const inner: Context = { ...ctx };
          if (name !== undefined) {
            const here = reps === 1 ? name : `${name} ${i}/${reps}`;
            inner.block = ctx.block === undefined ? here : `${ctx.block} · ${here}`;
          }
          walk(step.segments, withDescription(inner, step.description));
          if (step.rest && i < reps) addRest(step.rest, ctx);
        }
        continue;
      }
      const label = step.label ?? KIND_LABEL[step.kind] ?? step.kind;
      for (let i = 1; i <= reps; i++) {
        // "Intervall 2/4", or with a custom label "Block 1 · 2/10"
        const repLabel = reps === 1 ? label : step.label ? `${label} · ${i}/${reps}` : `${label} ${i}/${reps}`;
        add(step.kind, repLabel, step.duration, step.target, tol(step, defaultTolerance), withDescription(ctx, step.description));
        if (step.rest && i < reps) addRest(step.rest, ctx);
      }
    }
  };
  walk(workout.segments, {});
  return out;
}

/** The context with a more specific description, when there is one. */
const withDescription = (ctx: Context, description: string | undefined): Context => (description === undefined ? ctx : { ...ctx, description });

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
