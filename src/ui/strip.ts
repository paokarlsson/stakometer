// The workout's parts as a strip: one box per top-level step, its width by duration and a
// small profile of the targets inside. The live view highlights the current part (spec §8.2).
import { expand, KIND_LABEL, BLOCK_LABEL, totalDuration } from '../workout/expand';
import type { TimelineSegment, Workout, WorkoutStep } from '../workout/schema';
import { h } from './dom';
import { formatDuration } from './format';

export interface StripPart {
  start: number; // s of timeline
  end: number;
  title: string; // e.g. "Uppvärmning", "Block 1"
  detail: string; // e.g. "10:00", "10 × 0:40/0:20"
}

const MERGED_KINDS = new Set(['warmup', 'cooldown']);

const durationOf = (step: WorkoutStep): number => totalDuration(expand({ id: '', name: '', segments: [step] }, null));

/**
 * One part per top-level step. Consecutive single warm-up (or cool-down) segments become
 * one part, so a warm-up with pickups shows as "Uppvärmning 10:00".
 */
export function stripParts(workout: Workout): StripPart[] {
  const parts: (StripPart & { merge: string | null })[] = [];
  let t = 0;
  for (const step of workout.segments) {
    const d = durationOf(step);
    const reps = step.repeat ?? 1;
    const merge = step.kind !== 'block' && reps === 1 && MERGED_KINDS.has(step.kind) ? step.kind : null;
    const prev = parts.at(-1);
    if (merge && prev?.merge === merge) {
      prev.end += d;
      prev.title = KIND_LABEL[merge]!;
      prev.detail = formatDuration(prev.end - prev.start);
    } else if (step.kind === 'block') {
      const once = durationOf({ ...step, repeat: 1, rest: undefined });
      parts.push({ start: t, end: t + d, title: step.label ?? BLOCK_LABEL, detail: reps > 1 ? `${reps} × ${formatDuration(once)}` : formatDuration(d), merge });
    } else {
      const title = step.label ?? KIND_LABEL[step.kind] ?? step.kind;
      const rest = step.rest ? `/${formatDuration(step.rest.duration)}` : '';
      parts.push({ start: t, end: t + d, title, detail: reps > 1 ? `${reps} × ${formatDuration(step.duration)}${rest}` : formatDuration(d), merge });
    }
    t += d;
  }
  return parts.map(({ merge: _merge, ...p }) => p);
}

/** Index of the part containing timeline time t; the last part at or after the end. */
export function partIndexAt(parts: readonly StripPart[], t: number): number {
  const i = parts.findIndex((p) => t < p.end);
  return i === -1 ? parts.length - 1 : i;
}

/**
 * The strip. `timeline` gives the bar heights (any signature will do, they are relative).
 * `update(t)` marks the part at timeline time t; null shows the strip without progress.
 */
export function workoutStrip(workout: Workout, timeline: readonly TimelineSegment[]): { el: HTMLElement; update: (t: number | null) => void } {
  const parts = stripParts(workout);
  const highest = Math.max(1, ...timeline.map((s) => s.targetW ?? 0));
  const boxes = parts.map((part) => {
    const span = Math.max(1, part.end - part.start);
    const bars = timeline
      .filter((s) => s.start < part.end && s.end > part.start)
      .map((s) => {
        const left = ((Math.max(s.start, part.start) - part.start) / span) * 100;
        const width = ((Math.min(s.end, part.end) - Math.max(s.start, part.start)) / span) * 100;
        const height = s.isMax ? 100 : s.targetW !== null ? Math.max(8, (s.targetW / highest) * 92) : 8;
        return h('div', { class: s.isMax ? 'strip-bar max' : 'strip-bar', style: `left:${left}%;width:${width}%;height:${height}%` });
      });
    const done = h('div', { class: 'strip-done', hidden: true });
    const now = h('div', { class: 'strip-now', hidden: true });
    const el = h(
      'div',
      { class: 'strip-part', style: `flex:${span} 1 0`, title: `${part.title} ${part.detail}` },
      ...bars,
      h('div', { class: 'strip-text' }, h('span', {}, part.title), h('span', {}, part.detail)),
      done,
      now,
    );
    return { el, done, now, part, span };
  });

  let shown = '';
  const update = (t: number | null): void => {
    const current = t === null ? -1 : partIndexAt(parts, t);
    // Only touch the DOM when something visible changed (called every frame).
    const key = t === null ? 'none' : `${current}:${Math.floor(t)}`;
    if (key === shown) return;
    shown = key;
    boxes.forEach((b, i) => {
      b.el.classList.toggle('current', i === current);
      const f = t === null ? 0 : i < current ? 1 : i > current ? 0 : Math.min(1, Math.max(0, (t - b.part.start) / b.span));
      b.done.hidden = f <= 0;
      b.done.style.width = `${f * 100}%`;
      b.now.hidden = i !== current;
      b.now.style.left = `calc(${f * 100}% - 1px)`;
    });
  };
  update(null);
  return { el: h('div', { class: 'strip' }, ...boxes.map((b) => b.el)), update };
}
