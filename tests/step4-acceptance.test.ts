// Step 4 in plan.md §3: the four tests run in the simulator (fatigue, true signature
// 550/220/18 000) give a fitted signature with CP within ±3 % and W′ within ±10 %,
// with a residual per test, and a changed drag factor is caught.
//
// The outcome is statistical. Measured over 16 seeds (2026-09-29, W′ model
// Skiba 2015): CP is always within ±2 %, W′ within ±10 % in 14 of 16 (12 of 16 with
// the earlier three tests 30 s, 3 min and 10 min). The simulator's maximal effort
// follows its true model exactly, so the residuals stay under 2 W. The seeds below
// are fixed so the test is deterministic.
import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { simulatorSignature } from '../src/model/signature';
import { analyzeSession } from '../src/session/analysis';
import { LiveSession } from '../src/session/live';
import { dragFactorDiffers, mixedDragFactors, previousTest, suggestSignature, testResultFrom } from '../src/session/testResults';
import { seededRandom, Simulator, TRUE_SIGNATURE } from '../src/sources/simulator';
import type { TestResult } from '../src/storage/types';
import { TEST_WORKOUTS } from '../src/workout/builtin';
import { expand } from '../src/workout/expand';
import { MemoryStore } from './helpers/memoryStore';

async function runTest(workoutIndex: number, seed: number, day: number, dragFactor = 110): Promise<{ result: TestResult; live: LiveSession }> {
  let real = 0;
  const clock = new SimClock(1, () => real);
  const store = new MemoryStore();
  const workout = TEST_WORKOUTS[workoutIndex]!;
  const signature = simulatorSignature();
  let live: LiveSession | null = null;
  const sim = new Simulator(clock, {
    mode: 'fatigue',
    random: seededRandom(seed),
    tickMs: 0,
    dragFactor,
    target: () => live?.runner.target() ?? null,
    maxEffort: () => live?.maxEffortDuration() ?? null,
  });
  await sim.connect();
  live = new LiveSession(sim, clock, store, { mode: 'test', workoutId: workout.id, timeline: expand(workout, signature), signature });
  await live.start();
  while (live.runner.state !== 'finished') {
    real += 0.05;
    sim.advance(clock.now());
    live.tick();
  }
  const session = await live.stop();
  const dated = { ...session, startedAt: new Date(Date.UTC(2026, 8, day)).toISOString() };
  const result = testResultFrom(dated, analyzeSession(dated, await store.getChunks(session.id)));
  expect(result).not.toBeNull();
  return { result: result!, live };
}

describe('step 4 acceptance', () => {
  it('fits CP within ±3 % and W′ within ±10 % of the true signature, with a residual per test', async () => {
    const results = [(await runTest(0, 1, 1)).result, (await runTest(1, 101, 3)).result, (await runTest(2, 201, 5)).result, (await runTest(3, 301, 7)).result];
    expect(results.map((r) => r.duration)).toEqual([30, 180, 360, 720]);
    expect(results.every((r) => r.simulated && r.dragFactor === 110)).toBe(true);

    const suggestion = suggestSignature(results, true);
    if (suggestion.kind !== 'fit' || !suggestion.fit.ok) throw new Error(JSON.stringify(suggestion));
    const { cp, wPrime, residuals } = suggestion.fit;
    expect(Math.abs(cp - TRUE_SIGNATURE.cp) / TRUE_SIGNATURE.cp).toBeLessThanOrEqual(0.03);
    expect(Math.abs(wPrime - TRUE_SIGNATURE.wPrime) / TRUE_SIGNATURE.wPrime).toBeLessThanOrEqual(0.1);
    expect(suggestion.missing).toEqual([]);
    expect(residuals).toHaveLength(4);
    residuals.forEach((r) => expect(Math.abs(r)).toBeLessThan(2));
    expect(mixedDragFactors(results)).toBeNull();
  }, 60_000);

  it('catches a drag factor that differs from the last test of the same length', async () => {
    const first = (await runTest(1, 101, 3)).result;
    const { result: second, live } = await runTest(1, 102, 10, 125);
    const previous = previousTest([first], 180, true);
    // What the live view compares before the maximal effort …
    expect(live.dragFactor()).toBe(125);
    expect(dragFactorDiffers(live.dragFactor()!, previous!.dragFactor!)).toBe(true);
    // … and what the result view warns about afterwards.
    expect(second.dragFactor).toBe(125);
    expect(mixedDragFactors([first, second])).toEqual({ min: 110, max: 125 });
  }, 60_000);
});
