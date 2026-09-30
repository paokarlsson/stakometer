// Workout format (spec §6.1) and the expanded timeline (§6.2).

export type Target = { watt: number } | { pctCP: number } | { max: true } | null;

export const SEGMENT_KINDS = ['warmup', 'interval', 'rest', 'steady', 'cooldown', 'test'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/** Rest between repetitions, not after the last. */
export interface RestSpec {
  duration: number; // s
  target: Target;
  tolerance?: number;
  description?: string;
}

export interface WorkoutSegment {
  kind: SegmentKind;
  /** Optional name shown instead of the kind's name, e.g. "Ökning". */
  label?: string;
  /** Free text for the athlete, shown while the segment runs. */
  description?: string;
  duration: number; // s
  target: Target;
  /** Relative band half-width, e.g. 0.05 = ±5 %. */
  tolerance?: number;
  repeat?: number;
  rest?: RestSpec;
}

/** A group of steps, optionally repeated, e.g. 3 × (10 × 40/20) (spec §6.1). */
export interface WorkoutBlock {
  kind: 'block';
  label?: string;
  /** Shown for every segment in the block that has no description of its own. */
  description?: string;
  repeat?: number;
  /** Rest between repetitions of the whole block. */
  rest?: RestSpec;
  segments: WorkoutStep[];
}

export type WorkoutStep = WorkoutSegment | WorkoutBlock;

export interface Workout {
  id: string;
  name: string;
  description?: string;
  /** Empty for an unstructured workout, which runs like free ride with its description. */
  segments: WorkoutStep[];
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
  /** The enclosing blocks, e.g. "Serie 2/3"; missing outside labelled or repeated blocks. */
  block?: string;
  /** The segment's own description, else the nearest enclosing block's. */
  description?: string;
}

/** Deepest nesting of blocks accepted in a file. */
export const MAX_BLOCK_DEPTH = 4;

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

function parseText(v: unknown, field: string, where: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string' && v.trim()) return v;
  throw new Error(`${where}: ${field} måste vara en text`);
}

function parseRepeat(v: unknown, where: string): number | undefined {
  if (v === undefined) return undefined;
  if (Number.isInteger(v) && (v as number) >= 1) return v as number;
  throw new Error(`${where}: repeat måste vara ett heltal ≥ 1`);
}

function parseRest(v: unknown, where: string): RestSpec | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v) || !positive(v.duration)) throw new Error(`${where}: rest måste ha duration > 0`);
  const tolerance = parseTolerance(v.tolerance, `${where} rest`);
  const description = parseText(v.description, 'description', `${where} rest`);
  return {
    duration: v.duration,
    target: parseTarget(v.target, `${where} rest`),
    ...(tolerance !== undefined && { tolerance }),
    ...(description !== undefined && { description }),
  };
}

/** Optional label, description, repeat and rest, shared by segments and blocks. */
function parseCommon(raw: Record<string, unknown>, where: string): Pick<WorkoutSegment, 'label' | 'description' | 'repeat' | 'rest'> {
  const label = parseText(raw.label, 'label', where);
  const description = parseText(raw.description, 'description', where);
  const repeat = parseRepeat(raw.repeat, where);
  const rest = parseRest(raw.rest, where);
  return {
    ...(label !== undefined && { label }),
    ...(description !== undefined && { description }),
    ...(repeat !== undefined && { repeat }),
    ...(rest !== undefined && { rest }),
  };
}

function parseSteps(raw: unknown[], where: string, depth: number): WorkoutStep[] {
  return raw.map((step, i): WorkoutStep => {
    const at = `${where}${where.endsWith('segment') ? ' ' : '.'}${i + 1}`;
    if (!isObject(step)) throw new Error(`${at}: måste vara ett objekt`);
    if (step.kind === 'block') {
      if (depth >= MAX_BLOCK_DEPTH) throw new Error(`${at}: block får vara nästlade i högst ${MAX_BLOCK_DEPTH} nivåer`);
      if (!Array.isArray(step.segments) || step.segments.length === 0) throw new Error(`${at}: blocket saknar segment`);
      const { label, description, repeat, rest } = parseCommon(step, at);
      return {
        kind: 'block',
        ...(label !== undefined && { label }),
        ...(description !== undefined && { description }),
        ...(repeat !== undefined && { repeat }),
        ...(rest !== undefined && { rest }),
        segments: parseSteps(step.segments, at, depth + 1),
      };
    }
    if (!SEGMENT_KINDS.includes(step.kind as SegmentKind)) throw new Error(`${at}: okänd kind "${String(step.kind)}"`);
    if (!positive(step.duration)) throw new Error(`${at}: duration måste vara > 0`);
    const { label, description, repeat, rest } = parseCommon(step, at);
    const tolerance = parseTolerance(step.tolerance, at);
    return {
      kind: step.kind as SegmentKind,
      ...(label !== undefined && { label }),
      ...(description !== undefined && { description }),
      duration: step.duration,
      target: parseTarget(step.target, at),
      ...(tolerance !== undefined && { tolerance }),
      ...(repeat !== undefined && { repeat }),
      ...(rest !== undefined && { rest }),
    };
  });
}

/**
 * Validates unknown JSON as a Workout. Throws with a readable message.
 * Without `segments` the workout is unstructured; an empty list is an error.
 */
export function parseWorkout(json: unknown): Workout {
  if (!isObject(json)) throw new Error('Passet måste vara ett objekt');
  const { id, name, segments } = json;
  if (typeof id !== 'string' || !id) throw new Error('Passet saknar id');
  if (typeof name !== 'string' || !name) throw new Error(`${id}: passet saknar namn`);
  const description = parseText(json.description, 'description', id);
  if (segments !== undefined && (!Array.isArray(segments) || segments.length === 0)) {
    throw new Error(`${id}: passet saknar segment (utelämna segments för ett ostrukturerat pass)`);
  }
  return {
    id,
    name,
    ...(description !== undefined && { description }),
    segments: segments === undefined ? [] : parseSteps(segments, `${id} segment`, 0),
  };
}

/** True when the workout has segments, i.e. a timeline. Unstructured workouts run like free ride. */
export const isStructured = (w: Workout): boolean => w.segments.length > 0;

/** Every segment in the workout, blocks flattened, repeats not expanded. */
export function segmentsOf(steps: readonly WorkoutStep[]): WorkoutSegment[] {
  return steps.flatMap((s) => (s.kind === 'block' ? segmentsOf(s.segments) : [s]));
}

/** Every target in the workout: segments and the rests of segments and blocks. */
function targetsOf(steps: readonly WorkoutStep[]): Target[] {
  return steps.flatMap((s) => [
    ...(s.kind === 'block' ? targetsOf(s.segments) : [s.target]),
    ...(s.rest ? [s.rest.target] : []),
  ]);
}

/** Duration of the workout's maximal effort (a { max: true } segment), or null if it is not a test. */
export function maxEffortDuration(w: Workout): number | null {
  const seg = segmentsOf(w.segments).find((s) => s.target !== null && 'max' in s.target);
  return seg ? seg.duration : null;
}

/** True when the workout needs a signature to turn %CP into watts. */
export function usesPctCP(w: Workout): boolean {
  return targetsOf(w.segments).some((t) => t !== null && 'pctCP' in t);
}
