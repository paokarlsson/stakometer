// Test results and the signature suggestion (spec §7.3).
import { fit3p, type FitResult } from '../model/fit3p';
import type { Session, TestResult } from '../storage/types';
import type { SessionAnalysis } from './analysis';

export const TEST_DURATIONS = [30, 180, 600] as const;
export const SUGGESTION_WINDOW_DAYS = 14;

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
    ...(session.source === 'simulator' && { simulated: true }),
  };
}

export type Suggestion =
  | { kind: 'fit'; results: TestResult[]; fit: FitResult }
  | { kind: 'missing'; durations: number[]; results: TestResult[] };

/**
 * Uses the latest result for each test length. When all three lengths lie within
 * 14 days of each other, runs fit3p. Real and simulated results are never mixed.
 */
export function suggestSignature(all: readonly TestResult[], simulated: boolean): Suggestion {
  const latest = TEST_DURATIONS.map((d) =>
    all
      .filter((r) => r.duration === d && !!r.simulated === simulated)
      .sort((a, b) => b.date.localeCompare(a.date))[0],
  );
  const results = latest.filter((r): r is TestResult => r !== undefined);
  const missing = TEST_DURATIONS.filter((_, i) => !latest[i]);
  if (missing.length > 0) return { kind: 'missing', durations: missing, results };

  const times = results.map((r) => Date.parse(r.date));
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  if (spanDays > SUGGESTION_WINDOW_DAYS) {
    // The oldest is too old: it has to be redone.
    const oldest = results.reduce((a, b) => (a.date < b.date ? a : b));
    return { kind: 'missing', durations: [oldest.duration], results: results.filter((r) => r !== oldest) };
  }
  return { kind: 'fit', results, fit: fit3p(results.map((r) => ({ t: r.duration, p: r.avgPower }))) };
}
