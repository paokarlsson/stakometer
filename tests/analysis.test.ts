import { describe, expect, it } from 'vitest';
import { analyzeSession, timelineMapper } from '../src/session/analysis';
import { suggestSignature, testResultFrom } from '../src/session/testResults';
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

/** One stroke per second at the given powers, starting at t = 0.5. */
const chunk = (powers: number[], runner: Chunk['runner']): Chunk => ({
  sessionId: 's',
  seq: 0,
  strokes: powers.map((power, i) => ({ t: i + 0.5, pmElapsed: 0, power, strokeRate: 30, strokeCount: i + 1, distance: 0 })),
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
    expect(full.maxEffort).toMatchObject({ avgPower: 400, complete: true });
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
});

describe('suggestSignature (§7.3)', () => {
  const r = (duration: number, avgPower: number, date: string, simulated = false): TestResult => ({
    id: `${duration}-${date}`,
    sessionId: 'x',
    machine: 'skierg',
    duration,
    avgPower,
    date,
    ...(simulated && { simulated }),
  });

  it('lists missing lengths', () => {
    const s = suggestSignature([r(30, 440, '2026-09-01')], false);
    expect(s).toMatchObject({ kind: 'missing', durations: [180, 600] });
  });

  it('fits the latest result per length when all three are within 14 days', () => {
    const s = suggestSignature(
      [r(30, 400, '2026-08-01'), r(30, 440.83, '2026-09-01'), r(180, 285.54, '2026-09-05'), r(600, 236.78, '2026-09-14')],
      false,
    );
    expect(s.kind).toBe('fit');
    if (s.kind === 'fit' && s.fit.ok) expect(s.fit.cp).toBeCloseTo(211, 0);
    else throw new Error('expected a fit');
  });

  it('asks to redo the oldest test when the three span more than 14 days', () => {
    const s = suggestSignature([r(30, 440, '2026-08-01'), r(180, 285, '2026-09-05'), r(600, 236, '2026-09-10')], false);
    expect(s).toMatchObject({ kind: 'missing', durations: [30] });
  });

  it('never mixes simulated and real results', () => {
    const results = [r(30, 440, '2026-09-01', true), r(180, 285, '2026-09-02'), r(600, 236, '2026-09-03')];
    expect(suggestSignature(results, false)).toMatchObject({ kind: 'missing', durations: [30] });
    expect(suggestSignature(results, true)).toMatchObject({ kind: 'missing', durations: [180, 600] });
  });
});
