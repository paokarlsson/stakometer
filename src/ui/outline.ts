// Text outline of a workout's structure, for a planned workout on the start page (spec §6.7).
import { BLOCK_LABEL, expand, KIND_LABEL, totalDuration } from '../workout/expand';
import { isStructured, type RestSpec, type Target, type Workout, type WorkoutStep } from '../workout/schema';
import { formatDuration } from './format';

export interface OutlineLine {
  depth: number; // block nesting
  text: string; // e.g. "5 × Intervall 4:00 · 108 % CP, vila 3:00 · 45 % CP"
  description?: string;
}

const num = (n: number, decimals = 1): string => n.toLocaleString('sv-SE', { maximumFractionDigits: decimals });

/** "108 % CP", "88–95 % CP" when the tolerance is set, "250 W", "MAX" or "utan mål". */
export function targetText(target: Target, tolerance?: number): string {
  if (target === null) return 'utan mål';
  if ('max' in target) return 'MAX';
  const [value, unit] = 'watt' in target ? [target.watt, ' W'] : [target.pctCP, ' % CP'];
  if (tolerance === undefined || tolerance === 0) return `${num(value)}${unit}`;
  return `${num(value * (1 - tolerance), 0)}–${num(value * (1 + tolerance), 0)}${unit}`;
}

const restText = (rest: RestSpec | undefined): string =>
  rest ? `, vila ${formatDuration(rest.duration)}${rest.target === null ? '' : ` · ${targetText(rest.target, rest.tolerance)}`}` : '';

const joined = (...parts: (string | undefined)[]): string | undefined => {
  const text = parts.filter((p) => p !== undefined).join(' · ');
  return text || undefined;
};

/** One line per segment or block, repeats written "5 × …", blocks followed by their steps. */
export function outline(steps: readonly WorkoutStep[], depth = 0): OutlineLine[] {
  return steps.flatMap((step): OutlineLine[] => {
    const times = (step.repeat ?? 1) > 1 ? `${step.repeat} × ` : '';
    const description = joined(step.description, step.rest?.description && `Vila: ${step.rest.description}`);
    if (step.kind === 'block') {
      const text = `${times}${step.label ?? BLOCK_LABEL}${restText(step.rest)}`;
      return [{ depth, text, ...(description && { description }) }, ...outline(step.segments, depth + 1)];
    }
    const name = step.label ?? KIND_LABEL[step.kind] ?? step.kind;
    const text = `${times}${name} ${formatDuration(step.duration)} · ${targetText(step.target, step.tolerance)}${restText(step.rest)}`;
    return [{ depth, text, ...(description && { description }) }];
  });
}

/** "1:02:00", or "ostrukturerat" for a workout without segments. */
export const workoutLength = (w: Workout): string => (isStructured(w) ? formatDuration(totalDuration(expand(w, null))) : 'ostrukturerat');
