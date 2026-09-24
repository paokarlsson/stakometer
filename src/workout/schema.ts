// Workout format (spec §6.1) and the expanded timeline (§6.2).

export type Target = { watt: number } | { pctCP: number } | { max: true } | null;

export const SEGMENT_KINDS = ['warmup', 'interval', 'rest', 'steady', 'cooldown', 'test'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export interface WorkoutSegment {
  kind: SegmentKind;
  /** Optional name shown instead of the kind's name, e.g. "Ökning". */
  label?: string;
  duration: number; // s
  target: Target;
  /** Relative band half-width, e.g. 0.05 = ±5 %. */
  tolerance?: number;
  repeat?: number;
  /** Rest between repetitions, not after the last. */
  rest?: { duration: number; target: Target; tolerance?: number };
}

export interface Workout {
  id: string;
  name: string;
  segments: WorkoutSegment[];
}

/** Expanded segment (spec §6.2). */
export interface TimelineSegment {
  start: number; // s from session start
  end: number;
  kind: string;
  label: string; // e.g. "Intervall 2/4"
  targetW: number | null; // null = no target
  lo: number | null;
  hi: number | null;
  isMax: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function parseTarget(v: unknown, where: string): Target {
  if (v === null) return null;
  if (isObject(v)) {
    if (positive(v.watt)) return { watt: v.watt };
    if (positive(v.pctCP)) return { pctCP: v.pctCP };
    if (v.max === true) return { max: true };
  }
  throw new Error(`${where}: target måste vara { watt }, { pctCP }, { max: true } eller null`);
}

function parseTolerance(v: unknown, where: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number' && v >= 0 && v < 1) return v;
  throw new Error(`${where}: tolerance måste vara en andel mellan 0 och 1`);
}

/** Validates unknown JSON as a Workout. Throws with a readable message. */
export function parseWorkout(json: unknown): Workout {
  if (!isObject(json)) throw new Error('Passet måste vara ett objekt');
  const { id, name, segments } = json;
  if (typeof id !== 'string' || !id) throw new Error('Passet saknar id');
  if (typeof name !== 'string' || !name) throw new Error(`${id}: passet saknar namn`);
  if (!Array.isArray(segments) || segments.length === 0) throw new Error(`${id}: passet saknar segment`);

  return {
    id,
    name,
    segments: segments.map((raw, i): WorkoutSegment => {
      const where = `${id} segment ${i + 1}`;
      if (!isObject(raw)) throw new Error(`${where}: måste vara ett objekt`);
      if (!SEGMENT_KINDS.includes(raw.kind as SegmentKind)) throw new Error(`${where}: okänd kind "${String(raw.kind)}"`);
      if (!positive(raw.duration)) throw new Error(`${where}: duration måste vara > 0`);
      const seg: WorkoutSegment = { kind: raw.kind as SegmentKind, duration: raw.duration, target: parseTarget(raw.target, where) };
      if (raw.label !== undefined) {
        if (typeof raw.label !== 'string' || !raw.label) throw new Error(`${where}: label måste vara en text`);
        seg.label = raw.label;
      }
      const tolerance = parseTolerance(raw.tolerance, where);
      if (tolerance !== undefined) seg.tolerance = tolerance;
      if (raw.repeat !== undefined) {
        if (!Number.isInteger(raw.repeat) || (raw.repeat as number) < 1) throw new Error(`${where}: repeat måste vara ett heltal ≥ 1`);
        seg.repeat = raw.repeat as number;
      }
      if (raw.rest !== undefined) {
        const r = raw.rest;
        if (!isObject(r) || !positive(r.duration)) throw new Error(`${where}: rest måste ha duration > 0`);
        const restTolerance = parseTolerance(r.tolerance, `${where} rest`);
        seg.rest = { duration: r.duration, target: parseTarget(r.target, `${where} rest`), ...(restTolerance !== undefined && { tolerance: restTolerance }) };
      }
      return seg;
    }),
  };
}

/** Duration of the workout's maximal effort (a { max: true } segment), or null if it is not a test. */
export function maxEffortDuration(w: Workout): number | null {
  const seg = w.segments.find((s) => s.target !== null && 'max' in s.target);
  return seg ? seg.duration : null;
}

/** True when the workout needs a signature to turn %CP into watts. */
export function usesPctCP(w: Workout): boolean {
  const pct = (t: Target) => t !== null && 'pctCP' in t;
  return w.segments.some((s) => pct(s.target) || (s.rest !== undefined && pct(s.rest.target)));
}
