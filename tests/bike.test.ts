import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { readingFromFtms } from '../src/sources/bike/ble';
import { BIKE_NOTIFY_INTERVAL_S, BikeSimulator } from '../src/sources/bike/simulator';
import type { StatusSample, StrokeSample } from '../src/sources/DataSource';
import { seededRandom } from '../src/sources/simulator';
import { LBF_TO_N, toMeasurement, type Measurement } from '../src/sources/TrainingDevice';
import { LiveSession } from '../src/session/live';
import { simulatorSignature } from '../src/model/signature';
import { COUNTDOWN_S } from '../src/workout/runner';
import { MemoryStore } from './helpers/memoryStore';

describe('toMeasurement', () => {
  const stroke: StrokeSample = { ts: 1, pmElapsed: 1, power: 200, strokeRate: 90, strokeCount: 1, raw: { avgDriveForce: 50 } };

  it('gives force in N on the SkiErg and no torque', () => {
    const m = toMeasurement(1, 'skierg', stroke, null);
    expect(m.force).toBeCloseTo(50 * LBF_TO_N);
    expect(m.torque).toBeNull();
    expect(m.speed).toBeNull();
    expect(m.distance).toBeNull();
  });

  it('gives torque from power and cadence on a bike', () => {
    const m = toMeasurement(1, 'bike', stroke, { ts: 1, pmElapsed: 1, strokeRate: 90, speed: 9 });
    expect(m.torque).toBeCloseTo(200 / ((2 * Math.PI * 90) / 60));
    expect(m.force).toBeNull();
    expect(m.speed).toBe(9);
    expect(m.heartRate).toBeNull();
  });

  it('has no torque without cadence', () => {
    expect(toMeasurement(1, 'bike', { ...stroke, strokeRate: 0 }, null).torque).toBeNull();
  });
});

describe('readingFromFtms', () => {
  it('converts km/h to m/s and drops a zero heart rate', () => {
    const r = readingFromFtms({ speed: 36, cadence: 90, power: 250, heartRate: 0, resistance: 10 });
    expect(r.speed).toBeCloseTo(10);
    expect(r.heartRate).toBeUndefined();
    expect(r.raw).toEqual({ resistance: 10 });
  });
});

async function runSim(seconds: number, target: number | null = 200) {
  let real = 0;
  const clock = new SimClock(1, () => real);
  const sim = new BikeSimulator(clock, { random: seededRandom(7), tickMs: 0, target: () => target });
  const strokes: StrokeSample[] = [];
  const status: StatusSample[] = [];
  const meas: Measurement[] = [];
  sim.onStroke((s) => strokes.push(s));
  sim.onStatus((s) => status.push(s));
  sim.onMeasurement((m) => meas.push(m));
  await sim.connect();
  for (let t = 0.05; t <= seconds + 1e-9; t += 0.05) {
    real = t;
    sim.advance(clock.now());
  }
  return { sim, strokes, status, meas };
}

describe('BikeSimulator', () => {
  it('sends FTMS data at a steady rate through the parser', async () => {
    const { strokes, status } = await runSim(10);
    expect(strokes.length).toBe(Math.round(10 / BIKE_NOTIFY_INTERVAL_S));
    expect(status.length).toBe(strokes.length);
    const avg = strokes.reduce((a, s) => a + s.power, 0) / strokes.length;
    expect(avg).toBeGreaterThan(180);
    expect(avg).toBeLessThan(220);
    expect(strokes.every((s) => s.strokeRate > 60 && s.strokeRate < 110)).toBe(true);
    expect(status.at(-1)!.speed! * 3.6).toBeGreaterThan(28);
    expect(status.at(-1)!.distance!).toBeGreaterThan(status[0]!.distance!);
    expect(status.every((s) => s.heartRate === undefined)).toBe(true);
  });

  it('gives normalized measurements with cadence, speed and torque but no heart rate', async () => {
    const { meas } = await runSim(3);
    const m = meas.at(-1)!;
    expect(m.power).toBeGreaterThan(0);
    expect(m.cadence).toBeGreaterThan(0);
    expect(m.speed).toBeGreaterThan(0);
    expect(m.torque).toBeGreaterThan(0);
    expect(m.heartRate).toBeNull();
    expect(m.force).toBeNull();
  });

  it('runs a live session recorded as a bike session', async () => {
    let real = 0;
    const clock = new SimClock(1, () => real);
    const sim = new BikeSimulator(clock, { random: seededRandom(3), tickMs: 0, freePower: 250 });
    await sim.connect();
    const store = new MemoryStore();
    const live = new LiveSession(sim, clock, store, { mode: 'free', timeline: null, signature: simulatorSignature('trainer') });
    const started = await live.start();
    expect(started).toMatchObject({ machine: 'trainer', sport: 'bike', source: 'simulator' });
    for (let t = 0; t <= COUNTDOWN_S + 30; t += 0.05) {
      real = t;
      sim.advance(clock.now());
      live.tick();
    }
    expect(live.currentPowerAvg()).toBeGreaterThan(200);
    expect(live.strokeRate()).toBeGreaterThan(60);
    expect(live.speed()).toBeGreaterThan(0);
    expect(live.torque()).toBeGreaterThan(0);
    expect(live.heartRate()).toBeNull();
    expect(live.distance()).toBeGreaterThan(0);
    expect(live.wbalFraction()).toBeLessThan(1);
    const done = await live.stop();
    expect(done.summary!.avgPower).toBeGreaterThan(200);
    expect(done.summary!.distance).toBeGreaterThan(0);
  });

  it('manual mode: standing still gives 0 W and cadence 0', async () => {
    let real = 0;
    const clock = new SimClock(1, () => real);
    const sim = new BikeSimulator(clock, { random: seededRandom(1), tickMs: 0, mode: 'manual' });
    const strokes: StrokeSample[] = [];
    sim.onStroke((s) => strokes.push(s));
    await sim.connect();
    sim.setPulling(false);
    real = 2;
    sim.advance(clock.now());
    expect(strokes.every((s) => s.power === 0 && s.strokeRate === 0)).toBe(true);
  });
});

describe('summary without distance', () => {
  it('gives null distance when a trainer sends none (Cycling Power)', async () => {
    const { summarize } = await import('../src/session/summary');
    const strokes = [1, 2, 3].map((t) => ({ t, pmElapsed: t, power: 200, strokeRate: 0, strokeCount: t }));
    expect(summarize([{ sessionId: 'x', seq: 0, strokes, status: [{ t: 1, pmElapsed: 1 }] }]).distance).toBeNull();
  });
});
