import { describe, expect, it } from 'vitest';
import { analyzeSession, intervalRows, strokeStats, timelineMapper } from '../src/session/analysis';
import { powerAt } from '../src/model/morton3p';
import { dragFactorDiffers, mixedDragFactors, previousTest, suggestSignature, testResultFrom } from '../src/session/testResults';
import type { Chunk, Session, TestResult } from '../src/storage/types';
import type { TimelineSegment } from '../src/workout/schema';

const seg = (start: number, end: number, targetW: number | null, isMax = false): TimelineSegment => ({
  start,
  end,
  kind: isMax ? 'test' : 'interval',
  label: 'x',
  targetW,
  lo: targetW === null ? null : targetW * 0.95,
  hi: targetW === null ? null : targetW * 1.05,
  isMax,
});

const session = (timeline: TimelineSegment[] | null, mode: Session['mode'] = 'workout'): Session => ({
  id: 's',
  startedAt: '2026-09-24T10:00:00.000Z',
  machine: 'skierg',
  source: 'simulator',
  mode,
  timeline,
  signatureId: 'sig',
  signatureSnapshot: { id: 'sig', machine: 'skierg', pp: 500, cp: 200, wPrime: 15000, createdAt: '', source: 'manual' },
  status: 'completed',
  summary: null,
});

/** One stroke per second at the given powers, starting at t = 0.5, with drag factors if given. */
const chunk = (powers: number[], runner: Chunk['runner'], dragFactors?: number[]): Chunk => ({
  sessionId: 's',
  seq: 0,
  strokes: powers.map((power, i) => ({
    t: i + 0.5,
    pmElapsed: 0,
    power,
    strokeRate: 30,
    strokeCount: i + 1,
    distance: 0,
    ...(dragFactors && { raw: { dragFactor: dragFactors[i]! } }),
  })),
  status: [],
  runner,
});

describe('timelineMapper', () => {
  it('runs the timeline between running and paused/finished', () => {
    const map = timelineMapper([
      { t: -5, state: 'countdown' },
      { t: 0, state: 'running' },
      { t: 10, state: 'paused' },
      { t: 20, state: 'running' },
      { t: 30, state: 'finished' },
    ]);
    expect(map(5)).toBe(5);
    expect(map(15)).toBeNull();
    expect(map(25)).toBe(15);
    expect(map(-2)).toBeNull();
    expect(map(35)).toBeNull();
  });
});

describe('analyzeSession', () => {
  it('gives per-segment average and time in band, skipping pauses', () => {
    const timeline = [seg(0, 10, 200), seg(10, 20, 300)];
    // 10 s at 200 W, 5 s paused (at 0 W), then 10 s at 330 W (above the 285–315 band) with 5 in band
    const powers = [...Array(10).fill(200), ...Array(5).fill(0), ...Array(5).fill(330), ...Array(5).fill(300)];
    const a = analyzeSession(session(timeline), [
      chunk(powers, [
        { t: 0, state: 'running' },
        { t: 10, state: 'paused' },
        { t: 15, state: 'running' },
        { t: 25, state: 'finished' },
      ]),
    ]);
    expect(a.power).toHaveLength(24);
    expect(a.segments[0]).toMatchObject({ seconds: 10, avgPower: 200, inBand: 1 });
    expect(a.segments[1]!.seconds).toBe(9);
    expect(a.segments[1]!.inBand).toBeCloseTo(4 / 9);
    expect(a.wbal).toHaveLength(24);
    expect(a.maxEffort).toBeNull();
  });

  it('finds the maximal effort and whether it was complete', () => {
    const timeline = [seg(0, 5, 100), seg(5, 15, null, true), seg(15, 20, 100)];
    const powers = [...Array(5).fill(100), ...Array(10).fill(400), ...Array(5).fill(100)];
    const full = analyzeSession(session(timeline, 'test'), [chunk(powers, [{ t: 0, state: 'running' }, { t: 20, state: 'finished' }])]);
    expect(full.maxEffort).toMatchObject({ avgPower: 400, complete: true, dragFactor: null });
    const cut = analyzeSession(session(timeline, 'test'), [chunk(powers.slice(0, 10), [{ t: 0, state: 'running' }, { t: 10, state: 'finished' }])]);
    expect(cut.maxEffort?.complete).toBe(false);
    expect(testResultFrom(session(timeline, 'test'), cut)).toBeNull();
    expect(testResultFrom(session(timeline, 'test'), full, () => 'r1')).toEqual({
      id: 'r1',
      sessionId: 's',
      machine: 'skierg',
      duration: 10,
      avgPower: 400,
      date: '2026-09-24T10:00:00.000Z',
      simulated: true,
    });
  });

  it('takes the median drag factor over the maximal effort', () => {
    const timeline = [seg(0, 5, 100), seg(5, 15, null, true), seg(15, 20, 100)];
    const powers = [...Array(5).fill(100), ...Array(10).fill(400), ...Array(5).fill(100)];
    // 90 during warm-up and cool-down; 110–112 during the effort, with one outlier.
    const dfs = [...Array(5).fill(90), 110, 111, 111, 112, 111, 150, 111, 110, 111, 112, ...Array(5).fill(90)];
    const a = analyzeSession(session(timeline, 'test'), [chunk(powers, [{ t: 0, state: 'running' }, { t: 20, state: 'finished' }], dfs)]);
    expect(a.maxEffort?.dragFactor).toBe(111);
    expect(testResultFrom(session(timeline, 'test'), a, () => 'r1')).toMatchObject({ dragFactor: 111 });
  });
});

describe('result view (§8.3)', () => {
  it('gives the lowest W′ per segment', () => {
    const timeline = [seg(0, 10, 300), seg(10, 20, 100)];
    // 10 s at 100 W over CP drains 1000 J of 15 000; recovery follows.
    const powers = [...Array(10).fill(300), ...Array(10).fill(100)];
    const a = analyzeSession(session(timeline), [chunk(powers, [{ t: 0, state: 'running' }, { t: 20, state: 'finished' }])]);
    expect(a.segments[0]!.minWbal).toBeCloseTo((15000 - 1000) / 15000, 3);
    expect(a.segments[1]!.minWbal!).toBeGreaterThan(a.segments[0]!.minWbal!);
    const none = analyzeSession({ ...session(timeline), signatureSnapshot: null }, [chunk(powers, [{ t: 0, state: 'running' }, { t: 20, state: 'finished' }])]);
    expect(none.segments[0]!.minWbal).toBeNull();
  });

  it('lists the intervals and the maximal effort, else every segment with a target', () => {
    const rest = { ...seg(10, 20, 80), kind: 'rest' };
    const steady = { ...seg(0, 10, 150), kind: 'steady' };
    const stats = (segments: TimelineSegment[]) => segments.map((segment) => ({ segment, seconds: 0, avgPower: null, inBand: null, minWbal: null }));
    expect(intervalRows(stats([seg(0, 10, 300), rest, seg(20, 30, null, true)])).map((x) => x.segment.start)).toEqual([0, 20]);
    expect(intervalRows(stats([steady, rest, { ...seg(20, 30, null), kind: 'cooldown' }])).map((x) => x.segment.start)).toEqual([0, 10]);
  });

  it('averages heart rate and stroke rate and takes the median drag factor', () => {
    const c = chunk([200, 200, 200], [], [110, 112, 150]);
    c.strokes[1]!.strokeRate = 36;
    c.status = [
      { t: 1, pmElapsed: 1, distance: 0, heartRate: 150 },
      { t: 2, pmElapsed: 2, distance: 0, heartRate: 160 },
      { t: 3, pmElapsed: 3, distance: 0 },
    ];
    expect(strokeStats([c])).toEqual({ avgHeartRate: 155, avgStrokeRate: 32, dragFactor: 112 });
    expect(strokeStats([chunk([200], [])])).toEqual({ avgHeartRate: null, avgStrokeRate: 30, dragFactor: null });
  });
});

describe('suggestSignature (§7.3)', () => {
  const r = (duration: number, avgPower: number, date: string, simulated = false, dragFactor?: number): TestResult => ({
    id: `${duration}-${date}`,
    sessionId: 'x',
    machine: 'skierg',
    duration,
    avgPower,
    date,
    ...(dragFactor !== undefined && { dragFactor }),
    ...(simulated && { simulated }),
  });
  // The reference signature in §5.3: CP 211, W′ 16 548, k 42.
  const ref = { pp: 211 + 16548 / 42, cp: 211, wPrime: 16548 };
  const at = (t: number, date: string, simulated = false) => r(t, powerAt(t, ref), date, simulated);

  it('lists the missing lengths until three are done', () => {
    expect(suggestSignature([], false)).toMatchObject({ kind: 'missing', durations: [30, 180, 360, 720], results: [] });
    const s = suggestSignature([at(30, '2026-09-01'), at(720, '2026-09-02')], false);
    expect(s).toMatchObject({ kind: 'missing', durations: [180, 360] });
  });

  it('fits three lengths within 14 days, using the latest result per length', () => {
    const s = suggestSignature([r(30, 400, '2026-08-01'), at(30, '2026-09-01'), at(180, '2026-09-05'), at(720, '2026-09-14')], false);
    if (s.kind !== 'fit' || !s.fit.ok) throw new Error('expected a fit');
    expect(s.results.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-05', '2026-09-14']);
    expect(s.missing).toEqual([360]);
    expect(s.fit.cp).toBeCloseTo(211, 0);
    expect(s.fit.residuals).toHaveLength(3);
  });

  it('fits all four with a residual per test', () => {
    const results = [at(30, '2026-09-01'), at(180, '2026-09-02'), r(360, powerAt(360, ref) - 6, '2026-09-03'), at(720, '2026-09-04')];
    const s = suggestSignature(results, false);
    if (s.kind !== 'fit' || !s.fit.ok) throw new Error('expected a fit');
    expect(s.missing).toEqual([]);
    expect(s.fit.residuals).toHaveLength(4);
    expect(s.fit.sse).toBeGreaterThan(1);
    // The 6 min test lies under the curve.
    expect(Math.min(...s.fit.residuals)).toBe(s.fit.residuals[2]);
  });

  it('only uses results within 14 days of the newest', () => {
    const s = suggestSignature([at(30, '2026-08-01'), at(180, '2026-09-05'), at(360, '2026-09-08'), at(720, '2026-09-10')], false);
    expect(s).toMatchObject({ kind: 'fit', missing: [30] });
    const t = suggestSignature([at(30, '2026-08-01'), at(180, '2026-08-02'), at(360, '2026-09-05'), at(720, '2026-09-10')], false);
    expect(t).toMatchObject({ kind: 'missing', durations: [30, 180] });
    if (t.kind === 'missing') expect(t.results.map((x) => x.duration)).toEqual([360, 720]);
  });

  it('never mixes simulated and real results', () => {
    const results = [at(30, '2026-09-01', true), at(180, '2026-09-02'), at(360, '2026-09-03'), at(720, '2026-09-04', true)];
    expect(suggestSignature(results, false)).toMatchObject({ kind: 'missing', durations: [30, 720] });
    expect(suggestSignature(results, true)).toMatchObject({ kind: 'missing', durations: [180, 360] });
  });

  it('finds the previous test of the same length and compares drag factors', () => {
    const all = [r(180, 280, '2026-09-01', false, 110), r(180, 285, '2026-09-10', false, 118), r(180, 290, '2026-09-12', true, 110), r(360, 250, '2026-09-11')];
    expect(previousTest(all, 180, false)?.date).toBe('2026-09-10');
    expect(previousTest(all, 180, false, '2026-09-10')?.date).toBe('2026-09-01');
    expect(previousTest(all, 180, true)?.date).toBe('2026-09-12');
    expect(previousTest(all, 720, false)).toBeUndefined();
    expect(dragFactorDiffers(110, 115)).toBe(false);
    expect(dragFactorDiffers(110, 116)).toBe(true);
    expect(mixedDragFactors(all)).toEqual({ min: 110, max: 118 });
    expect(mixedDragFactors([all[0]!, all[2]!, all[3]!])).toBeNull();
  });
});
