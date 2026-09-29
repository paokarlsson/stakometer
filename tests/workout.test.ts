import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { BUILTIN_WORKOUTS } from '../src/workout/builtin';
import { expand, highestTarget, segmentIndexAt, totalDuration } from '../src/workout/expand';
import { beepsDue, WorkoutRunner } from '../src/workout/runner';
import { parseWorkout, usesPctCP } from '../src/workout/schema';

const fourByFour = BUILTIN_WORKOUTS.find((w) => w.id === '4x4-threshold')!;

/** The example in spec §6.1, which the §6.2 reference test is defined on. */
const specExample = parseWorkout({
  id: '4x4-threshold',
  name: '4×4 min tröskel',
  segments: [
    { kind: 'warmup', duration: 600, target: { pctCP: 60 } },
    { kind: 'interval', duration: 240, target: { pctCP: 105 }, repeat: 4, rest: { duration: 120, target: { pctCP: 40 } } },
    { kind: 'cooldown', duration: 300, target: { pctCP: 50 } },
  ],
});

describe('parseWorkout', () => {
  it('accepts the built-in workouts', () => {
    expect(BUILTIN_WORKOUTS.map((w) => w.id)).toEqual([
      '4x4-threshold',
      '8x1-hard',
      '30min-steady',
      '2x15-threshold',
      '6x5-cp',
      '10x3-hard',
      '3x10-40-20',
    ]);
    expect(BUILTIN_WORKOUTS.every(usesPctCP)).toBe(true);
  });

  it('rejects malformed workouts with a readable message', () => {
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [] })).toThrow(/segment/);
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [{ kind: 'sprint', duration: 10, target: null }] })).toThrow(/kind/);
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [{ kind: 'steady', duration: 0, target: null }] })).toThrow(/duration/);
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [{ kind: 'steady', duration: 10, target: { pct: 5 } }] })).toThrow(/target/);
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [{ kind: 'steady', duration: 10, target: null, repeat: 1.5 }] })).toThrow(/repeat/);
  });
});

describe('expand (§6.2 reference test)', () => {
  const timeline = expand(specExample, { cp: 200 });

  it('gives 9 segments and 2 220 s', () => {
    expect(timeline).toHaveLength(9);
    expect(totalDuration(timeline)).toBe(2220);
    expect(timeline.map((s) => s.kind)).toEqual(['warmup', 'interval', 'rest', 'interval', 'rest', 'interval', 'rest', 'interval', 'cooldown']);
  });

  it('turns 105 % of CP 200 into 210 W with a 199.5–220.5 W band', () => {
    const interval = timeline[1]!;
    expect(interval.targetW).toBeCloseTo(210);
    expect(interval.lo).toBeCloseTo(199.5);
    expect(interval.hi).toBeCloseTo(220.5);
    expect(interval.label).toBe('Intervall 1/4');
    expect(timeline[7]!.label).toBe('Intervall 4/4');
  });

  it('is contiguous', () => {
    for (let i = 1; i < timeline.length; i++) expect(timeline[i]!.start).toBe(timeline[i - 1]!.end);
  });

  it('drops %CP targets without a signature and keeps watt and max targets', () => {
    const noSig = expand(specExample, null);
    expect(noSig.every((s) => s.targetW === null && s.lo === null)).toBe(true);
    const custom = expand(
      parseWorkout({ id: 'c', name: 'C', segments: [{ kind: 'steady', duration: 60, target: { watt: 250 }, tolerance: 0.1 }, { kind: 'test', duration: 30, target: { max: true } }] }),
      null,
    );
    expect(custom[0]).toMatchObject({ targetW: 250, lo: 225, hi: 275, isMax: false });
    expect(custom[1]).toMatchObject({ targetW: null, isMax: true, label: 'Test – MAX' });
  });

  it('finds segments and the highest target', () => {
    expect(segmentIndexAt(timeline, 0)).toBe(0);
    expect(segmentIndexAt(timeline, 600)).toBe(1);
    expect(segmentIndexAt(timeline, 2219.9)).toBe(8);
    expect(segmentIndexAt(timeline, 2220)).toBe(-1);
    expect(highestTarget(timeline)).toBeCloseTo(210);
  });
});

describe('added standard workouts', () => {
  const byId = (id: string) => expand(BUILTIN_WORKOUTS.find((w) => w.id === id)!, { cp: 200 });

  it('have no warm-up or cool-down, and the expected lengths', () => {
    for (const w of BUILTIN_WORKOUTS) expect(w.segments.some((s) => s.kind === 'warmup' || s.kind === 'cooldown'), w.id).toBe(false);
    expect(totalDuration(byId('4x4-threshold'))).toBe(4 * 240 + 3 * 120);
    expect(totalDuration(byId('8x1-hard'))).toBe(8 * 60 + 7 * 60);
    expect(totalDuration(byId('2x15-threshold'))).toBe(900 + 180 + 900);
    expect(totalDuration(byId('6x5-cp'))).toBe(6 * 300 + 5 * 60);
    expect(totalDuration(byId('10x3-hard'))).toBe(10 * 180 + 9 * 60);
    expect(byId('10x3-hard').filter((s) => s.kind === 'interval')).toHaveLength(10);
  });

  it('3×10 min 40/20: three blocks of 10 × 40 s with 20 s between, 3 min between blocks', () => {
    const t = byId('3x10-40-20');
    const hard = t.filter((s) => s.kind === 'interval');
    expect(hard).toHaveLength(30);
    expect(hard.every((s) => s.end - s.start === 40 && s.targetW === 240)).toBe(true);
    expect(hard[0]!.label).toBe('Block 1 · 1/10');
    expect(hard[29]!.label).toBe('Block 3 · 10/10');
    expect(t.filter((s) => s.kind === 'rest' && s.end - s.start === 20)).toHaveLength(27);
    expect(t.filter((s) => s.kind === 'rest' && s.end - s.start === 180)).toHaveLength(2);
    expect(totalDuration(t)).toBe(3 * 580 + 2 * 180);
  });
});

describe('WorkoutRunner (§6.3)', () => {
  const setup = (timeline = expand(specExample, { cp: 200 })) => {
    let real = 0;
    const clock = new SimClock(1, () => real);
    const runner = new WorkoutRunner(timeline, clock, 5); // these tests use a 5 s countdown
    const states: string[] = [];
    runner.stateChanged.on((s) => states.push(s));
    const at = (t: number) => {
      real = t;
      runner.update();
    };
    return { runner, states, at };
  };

  it('counts down 10 s by default', () => {
    let real = 0;
    const runner = new WorkoutRunner(expand(specExample, { cp: 200 }), new SimClock(1, () => real));
    runner.start();
    real = 9.9;
    runner.update();
    expect(runner.state).toBe('countdown');
    real = 10;
    runner.update();
    expect(runner.state).toBe('running');
  });

  it('counts down, then runs the timeline with the clock', () => {
    const { runner, states, at } = setup();
    runner.start();
    at(4.9);
    expect(runner.state).toBe('countdown');
    expect(runner.timelineTime()).toBeCloseTo(-0.1);
    at(5);
    expect(states).toEqual(['countdown', 'running']);
    at(5 + 700);
    expect(runner.timelineTime()).toBeCloseTo(700);
    expect(runner.current()).toMatchObject({ index: 1, remaining: expect.closeTo(140, 6), next: { kind: 'rest' } });
    expect(runner.target()).toBeCloseTo(210);
  });

  it('gives the simulator the ramped target', () => {
    const { runner, at } = setup(expand(fourByFour, { cp: 200 })); // 4×4 without warm-up
    runner.start();
    at(5 + 242.5); // 2.5 s into the rest after the first interval
    expect(runner.target()).toBeCloseTo(145);
  });

  it('freezes the timeline while paused but not session time', () => {
    const { runner, at } = setup();
    runner.start();
    at(105);
    runner.pause();
    expect(runner.target()).toBeNull();
    at(165);
    expect(runner.timelineTime()).toBeCloseTo(100);
    expect(runner.sessionTime()).toBeCloseTo(160);
    runner.resume();
    at(175);
    expect(runner.timelineTime()).toBeCloseTo(110);
  });

  it('maps session time to timeline time around a pause', () => {
    const { runner, at } = setup();
    runner.start();
    at(105);
    runner.pause();
    at(165);
    runner.resume();
    at(175); // session 170, timeline 110
    expect(runner.timelineAt(50)).toBeCloseTo(50);
    expect(runner.timelineAt(130)).toBeNull(); // paused
    expect(runner.timelineAt(165)).toBeCloseTo(105);
    expect(runner.timelineAt(200)).toBeCloseTo(140); // future
    expect(runner.timelineAt(-2)).toBe(-2);
  });

  it('finishes as completed when the timeline ends', () => {
    const { runner, states, at } = setup();
    runner.start();
    at(5 + 2220);
    expect(states.at(-1)).toBe('finished');
    expect(runner.isComplete).toBe(true);
    expect(runner.stop()).toBe('completed');
    expect(runner.timelineAt(3000)).toBeNull();
  });

  it('is aborted when stopped early, and free ride is always completed', () => {
    const a = setup();
    a.runner.start();
    a.at(100);
    expect(a.runner.stop()).toBe('aborted');

    let real = 0;
    const free = new WorkoutRunner(null, new SimClock(1, () => real));
    free.start();
    real = 3600;
    free.update();
    expect(free.state).toBe('running');
    expect(free.current()).toBeNull();
    expect(free.target()).toBeNull();
    expect(free.stop()).toBe('completed');
  });
});

describe('beepsDue', () => {
  it('beeps once as each of the last three seconds starts', () => {
    expect(beepsDue(3.2, 2.9)).toBe(1);
    expect(beepsDue(5, 0.5)).toBe(3);
    expect(beepsDue(0.9, 0.5)).toBe(0);
    expect(beepsDue(10, 9)).toBe(0);
  });
});

describe('test workouts (§7.1)', () => {
  it('have 10 min warm-up with two pickups, 3 min easy, the max effort and 5 min cool-down', async () => {
    const { TEST_WORKOUTS } = await import('../src/workout/builtin');
    const { maxEffortDuration } = await import('../src/workout/schema');
    expect(TEST_WORKOUTS.map((w) => [w.id, maxEffortDuration(w)])).toEqual([
      ['test-30s', 30],
      ['test-180s', 180],
      ['test-600s', 600],
    ]);
    const t = expand(TEST_WORKOUTS[1]!, { cp: 200 });
    expect(t.map((s) => s.label)).toEqual(['Uppvärmning', 'Ökning', 'Uppvärmning', 'Ökning', 'Uppvärmning', 'Lätt', 'Maxinsats – MAX', 'Nedvarvning']);
    expect(t[5]!.start).toBe(600);
    expect(t[6]).toMatchObject({ start: 780, end: 960, isMax: true, targetW: null });
    expect(totalDuration(t)).toBe(1260);
    expect(maxEffortDuration(fourByFour)).toBeNull();
  });
});
