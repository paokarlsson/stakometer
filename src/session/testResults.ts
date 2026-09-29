// Test results, the signature suggestion and the drag factor check (spec §7.3).
import { fit3p, type FitResult } from '../model/fit3p';
import type { Session, TestResult } from '../storage/types';
import type { SessionAnalysis } from './analysis';

/** The test battery (spec §7.1). */
export const TEST_DURATIONS = [30, 180, 360, 720] as const;
/** A suggestion needs results for at least this many lengths within the window. */
export const MIN_TEST_LENGTHS = 3;
export const SUGGESTION_WINDOW_DAYS = 14;
/** [FÖRSLAG] Drag factors further apart than this count as a different damper setting. */
export const DRAG_FACTOR_TOLERANCE = 5;

/** The test result of a completed test session, or null when there is none. */
export function testResultFrom(session: Session, analysis: SessionAnalysis, newId: () => string = () => crypto.randomUUID()): TestResult | null {
  const max = analysis.maxEffort;
  if (session.mode !== 'test' || !max || !max.complete) return null;
  return {
    id: newId(),
    sessionId: session.id,
    machine: session.machine,
    duration: max.segment.end - max.segment.start,
    avgPower: max.avgPower,
    date: session.startedAt,
    ...(max.dragFactor !== null && { dragFactor: Math.round(max.dragFactor) }),
    ...(session.source === 'simulator' && { simulated: true }),
  };
}

/** For a fit, `missing` lists the lengths in the battery that it did without. */
export type Suggestion =
  | { kind: 'fit'; results: TestResult[]; fit: FitResult; missing: number[] }
  | { kind: 'missing'; durations: number[]; results: TestResult[] };

const latestFirst = (a: TestResult, b: TestResult): number => b.date.localeCompare(a.date);

/**
 * Uses the latest result for each length in the battery, and of those the ones
 * within 14 days of the newest. With at least three lengths left, runs fit3p.
 * Real and simulated results are never mixed.
 */
export function suggestSignature(all: readonly TestResult[], simulated: boolean): Suggestion {
  const latest = TEST_DURATIONS.flatMap((d) => all.filter((r) => r.duration === d && !!r.simulated === simulated).sort(latestFirst).slice(0, 1));
  const newest = Math.max(...latest.map((r) => Date.parse(r.date)));
  const results = latest.filter((r) => newest - Date.parse(r.date) <= SUGGESTION_WINDOW_DAYS * 86_400_000);
  const missing = TEST_DURATIONS.filter((d) => !results.some((r) => r.duration === d));
  if (results.length < MIN_TEST_LENGTHS) return { kind: 'missing', durations: missing, results };
  return { kind: 'fit', results, missing, fit: fit3p(results.map((r) => ({ t: r.duration, p: r.avgPower }))) };
}

/** The latest test of the same length, to compare the drag factor with (spec §7.3). */
export function previousTest(all: readonly TestResult[], duration: number, simulated: boolean, before?: string): TestResult | undefined {
  return all
    .filter((r) => r.duration === duration && !!r.simulated === simulated && (before === undefined || r.date < before))
    .sort(latestFirst)[0];
}

export const dragFactorDiffers = (a: number, b: number): boolean => Math.abs(a - b) > DRAG_FACTOR_TOLERANCE;

/** Lowest and highest drag factor among the results when they differ, else null. */
export function mixedDragFactors(results: readonly TestResult[]): { min: number; max: number } | null {
  const dfs = results.flatMap((r) => (r.dragFactor === undefined ? [] : [r.dragFactor]));
  if (dfs.length < 2) return null;
  const min = Math.min(...dfs);
  const max = Math.max(...dfs);
  return dragFactorDiffers(min, max) ? { min, max } : null;
}
