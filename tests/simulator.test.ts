import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import type { StatusSample, StrokeSample } from '../src/sources/DataSource';
import { baseStrokeRate, seededRandom, Simulator, speedFromPower, type SimulatorOptions } from '../src/sources/simulator';

async function run(seconds: number, opts: SimulatorOptions = {}) {
  let real = 0;
  const clock = new SimClock(1, () => real);
  const sim = new Simulator(clock, { random: seededRandom(42), tickMs: 0, ...opts });
  const strokes: StrokeSample[] = [];
  const status: StatusSample[] = [];
  sim.onStroke((s) => strokes.push(s));
  sim.onStatus((s) => status.push(s));
  await sim.connect();
  for (let t = 0.05; t <= seconds; t += 0.05) {
    real = t;
    sim.advance(clock.now());
  }
  return { sim, strokes, status, advanceTo: (t: number) => ((real = t), sim.advance(clock.now())) };
}

describe('stroke rate and speed formulas', () => {
  it('clamps stroke rate to 25–60', () => {
    expect(baseStrokeRate(0)).toBe(28);
    expect(baseStrokeRate(200)).toBe(40);
    expect(baseStrokeRate(1000)).toBe(60);
  });

  it('uses P = 2.8 v³', () => {
    expect(speedFromPower(2.8 * 125)).toBeCloseTo(5);
    expect(speedFromPower(0)).toBe(0);
  });
});

describe('Simulator', () => {
  it('sends status every 100 ms', async () => {
    const { status } = await run(10);
    expect(status.length).toBeGreaterThanOrEqual(100);
    expect(status.length).toBeLessThanOrEqual(101);
    expect(status[1]!.ts - status[0]!.ts).toBeCloseTo(0.1);
  });

  it('follows the target with ~7 % noise at the matching stroke rate', async () => {
    const { strokes } = await run(600, { target: () => 250 });
    const powers = strokes.map((s) => s.power);
    const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
    expect(mean).toBeGreaterThan(240);
    expect(mean).toBeLessThan(260);
    const expectedRate = baseStrokeRate(250); // 43 spm
    expect(strokes.length / 10).toBeGreaterThan(expectedRate - 2);
    expect(strokes.length / 10).toBeLessThan(expectedRate + 2);
    expect(strokes.map((s) => s.strokeCount)).toEqual(strokes.map((_, i) => i + 1));
  });

  it('accumulates distance from power', async () => {
    const { status } = await run(60, { target: () => 2.8 * 125 }); // ≈ 5 m/s
    expect(status.at(-1)!.distance).toBeGreaterThan(250);
    expect(status.at(-1)!.distance).toBeLessThan(310);
  });

  it('manual mode: arrows change power, space stops strokes and the machine comes to rest', async () => {
    const { sim, strokes, status, advanceTo } = await run(30, { mode: 'manual', manualPower: 150 });
    sim.adjustPower(+10);
    sim.adjustPower(+10);
    expect(sim.power).toBe(170);
    sim.setPulling(false);
    const before = strokes.length;
    for (let t = 30; t <= 40; t += 0.05) advanceTo(t);
    expect(strokes.length).toBe(before);
    expect(status.at(-1)!.strokeRate).toBe(0);
    expect(status.at(-1)!.paceSecPer500).toBeUndefined();
  });
});
