import { beforeEach, describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { Emitter } from '../src/core/events';
import { recoverUnfinished, Recorder } from '../src/session/recorder';
import { summarize } from '../src/session/summary';
import type { ConnectionState, DataSource, StatusSample, StrokeSample } from '../src/sources/DataSource';
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

let real: number;
let clock: SimClock;
let store: MemoryStore;
let source: FakeSource;
let recorder: Recorder;

/** Emits one status per 0.1 s and one 200 W stroke per 2 s, up to `until` (clock time). */
function feed(from: number, until: number) {
  for (let i = Math.round(from * 10); i < Math.round(until * 10); i++) {
    real = 1000 + i / 10;
    const ts = clock.now();
    source.status.emit({ ts, pmElapsed: ts, distance: ts * 4 });
    if (i % 20 === 0) source.strokes.emit({ ts, pmElapsed: ts, power: 200, strokeRate: 30, strokeCount: i / 20 + 1, distance: ts * 4 });
  }
}

beforeEach(() => {
  real = 1000;
  clock = new SimClock(1, () => real);
  store = new MemoryStore();
  source = new FakeSource();
  let n = 0;
  recorder = new Recorder(store, clock, { newId: () => `s${++n}`, wallClock: () => new Date('2026-09-24T18:00:00Z') });
});

describe('Recorder', () => {
  it('writes the session at start as aborted without summary', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    expect(await store.getSession('s1')).toMatchObject({ mode: 'free', source: 'simulator', status: 'aborted', summary: null });
  });

  it('stores samples with t relative to session start', async () => {
    real = 1005;
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    real = 1007.5;
    source.strokes.emit({ ts: clock.now(), pmElapsed: 99, power: 210, strokeRate: 31, strokeCount: 1, distance: 10 });
    await recorder.stop('completed');
    const [chunk] = await store.getChunks('s1');
    expect(chunk!.strokes[0]).toEqual({ t: 2.5, pmElapsed: 99, power: 210, strokeRate: 31, strokeCount: 1, distance: 10 });
  });

  it('flushes a chunk every 30 s so a crash loses at most 30 s', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    feed(0, 95);
    await recorder.settled();
    const chunks = await store.getChunks('s1');
    expect(chunks.map((c) => c.status[0]!.t)).toEqual([0, expect.closeTo(30, 0), expect.closeTo(60, 0)]);
    for (const c of chunks) {
      const span = c.status.at(-1)!.t - c.status[0]!.t;
      expect(span).toBeLessThanOrEqual(30);
    }
  });

  it('keeps at most 30 s of data unwritten when the page dies mid-session', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    feed(0, 100);
    await recorder.settled();
    // Simulate a reload: no stop(), just read what was persisted.
    const persisted = (await store.getChunks('s1')).flatMap((c) => c.status);
    expect(100 - persisted.at(-1)!.t).toBeLessThanOrEqual(30);
  });

  it('stop writes the remaining data, the status and a summary', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    feed(0, 45);
    const done = await recorder.stop('completed');
    expect(done.status).toBe('completed');
    expect(done.summary).toEqual({ duration: expect.closeTo(44.9, 6), distance: expect.closeTo(179.6, 6), strokeCount: 23, avgPower: 200 });
    expect(await store.getSession('s1')).toEqual(done);
    expect(recorder.active).toBeNull();
  });

  it('stops listening after stop', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    await recorder.stop('completed');
    expect(source.strokes.size + source.status.size + source.connection.size).toBe(0);
  });

  it('records connection changes so gaps are visible', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    real = 1010;
    source.connection.emit('reconnecting');
    real = 1014;
    source.connection.emit('connected');
    await recorder.stop('completed');
    const [chunk] = await store.getChunks('s1');
    expect(chunk!.connection).toEqual([
      { t: 10, state: 'reconnecting' },
      { t: 14, state: 'connected' },
    ]);
  });
});

describe('recoverUnfinished', () => {
  it('summarises sessions left without summary and keeps them aborted', async () => {
    await recorder.start(source, { mode: 'free', machine: 'skierg' });
    feed(0, 65);
    await recorder.settled();
    const recovered = await recoverUnfinished(store);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: 's1', status: 'aborted' });
    expect(recovered[0]!.summary!.duration).toBeCloseTo(60);
    expect(await recoverUnfinished(store)).toHaveLength(0);
  });
});

describe('summarize', () => {
  it('handles an empty session', () => {
    expect(summarize([])).toEqual({ duration: 0, distance: 0, strokeCount: 0, avgPower: null });
  });

  it('takes distance as the difference over the session', () => {
    const summary = summarize([
      { sessionId: 'x', seq: 0, strokes: [], status: [{ t: 0, pmElapsed: 0, distance: 1000 }] },
      { sessionId: 'x', seq: 1, strokes: [], status: [{ t: 30, pmElapsed: 30, distance: 1150 }] },
    ]);
    expect(summary.distance).toBe(150);
    expect(summary.duration).toBe(30);
  });
});
