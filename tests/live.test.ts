import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { Emitter } from '../src/core/events';
import { LiveSession } from '../src/session/live';
import { COUNTDOWN_S } from '../src/workout/runner';
import type { ConnectionState, DataSource, StatusSample, StrokeSample } from '../src/sources/DataSource';
import { simulatorSignature } from '../src/model/signature';
import { expand } from '../src/workout/expand';
import { BUILTIN_WORKOUTS } from '../src/workout/builtin';
import { MemoryStore } from './helpers/memoryStore';

class FakeSource implements DataSource {
  readonly kind = 'simulator' as const;
  readonly strokes = new Emitter<StrokeSample>();
  readonly status = new Emitter<StatusSample>();
  readonly connection = new Emitter<ConnectionState>();
  async connect() {}
  async disconnect() {}
  onStroke = (cb: (s: StrokeSample) => void) => this.strokes.on(cb);
  onStatus = (cb: (s: StatusSample) => void) => this.status.on(cb);
  onConnection = (cb: (c: ConnectionState) => void) => this.connection.on(cb);
  machine = () => 'skierg' as const;
}

async function setup(timeline = expand(BUILTIN_WORKOUTS[0]!, { cp: 200 })) {
  let real = 0;
  const clock = new SimClock(1, () => real);
  const source = new FakeSource();
  const store = new MemoryStore();
  const live = new LiveSession(source, clock, store, { mode: 'workout', workoutId: 'w', timeline, signature: simulatorSignature() });
  await live.start();
  let n = 0;
  /** Strokes of `power` once per second from session time `from` to `to`, ticking every 0.25 s. */
  const ride = (from: number, to: number, power: number) => {
    for (let t = from; t < to; t += 0.25) {
      real = t + COUNTDOWN_S;
      if (Number.isInteger(t)) source.strokes.emit({ ts: clock.now(), pmElapsed: t, power, strokeRate: 36, strokeCount: ++n, distance: 0 });
      live.tick();
    }
  };
  return { live, store, ride, source };
}

describe('LiveSession', () => {
  it('drains W′ above CP, recovers below, and MPA follows', async () => {
    const { live, ride } = await setup();
    ride(0, 61, 300); // ticks to t = 60.75: 60 whole seconds at 100 W over CP → −6000 J
    expect(live.wbal).toBeCloseTo(15000 - 6000, 0);
    expect(live.mpa()).toBeCloseTo(200 + 9000 / 50, 0);
    expect(live.wbalFraction()).toBeCloseTo(0.6, 2);
    expect(live.timeToEmpty()).toBeCloseTo(9000 / 100, 0);
    ride(61, 121, 100);
    expect(live.wbal!).toBeGreaterThan(9500);
    expect(live.timeToEmpty()).toBeNull();
    expect(live.minWbal).toEqual({ value: expect.closeTo(9000, 0), t: 60 });
    expect(live.mpaSeries).toHaveLength(120);
  });

  it('averages the last 3 strokes and drops to 0 when standing still', async () => {
    const { live, ride } = await setup();
    ride(0, 3, 150);
    ride(3, 4, 300);
    expect(live.currentPowerAvg()).toBe(200);
    expect(live.power.at(-1)).toEqual({ t: 3, value: 200 });
    ride(4, 10, 0.0001); // no integer-second strokes of meaning: effectively 0 W
    expect(live.currentPowerAvg()).toBeLessThan(1);
  });

  it('records runner states and stops as aborted when ended early', async () => {
    const { live, store, ride } = await setup();
    ride(0, 30, 200);
    live.runner.pause();
    ride(30, 40, 0);
    live.runner.resume();
    ride(40, 45, 200);
    const session = await live.stop();
    expect(session.status).toBe('aborted');
    expect(session.summary!.minWbal).not.toBeNull();
    const events = (await store.getChunks(session.id)).flatMap((c) => c.runner ?? []);
    expect(events.map((e) => e.state)).toEqual(['countdown', 'running', 'paused', 'running', 'finished']);
    expect(events[1]!.t).toBeCloseTo(0, 1);
  });

  it('free ride without signature has no W′ or MPA and completes', async () => {
    let real = 0;
    const clock = new SimClock(1, () => real);
    const live = new LiveSession(new FakeSource(), clock, new MemoryStore(), { mode: 'free', timeline: null, signature: null });
    await live.start();
    real = 100;
    live.tick();
    expect(live.wbal).toBeNull();
    expect(live.mpa()).toBeNull();
    expect(live.timeToEmpty()).toBeNull();
    expect((await live.stop()).status).toBe('completed');
  });
});
