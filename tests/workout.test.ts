import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { BUILTIN_WORKOUTS } from '../src/workout/builtin';
import { expand, highestTarget, segmentIndexAt, totalDuration } from '../src/workout/expand';
import { beepsDue, WorkoutRunner } from '../src/workout/runner';
import { parseWorkout, usesPctCP } from '../src/workout/schema';

const fourByFour = BUILTIN_WORKOUTS.find((w) => w.id === '4x4-threshold')!;

describe('parseWorkout', () => {
  it('accepts the built-in workouts', () => {
    expect(BUILTIN_WORKOUTS.map((w) => w.id)).toEqual(['4x4-threshold', '8x1-hard', '30min-steady']);
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
  const timeline = expand(fourByFour, { cp: 200 });

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
    const noSig = expand(fourByFour, null);
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

describe('WorkoutRunner (§6.3)', () => {
  const setup = (timeline = expand(fourByFour, { cp: 200 })) => {
    let real = 0;
    const clock = new SimClock(1, () => real);
    const runner = new WorkoutRunner(timeline, clock);
    const states: string[] = [];
    runner.stateChanged.on((s) => states.push(s));
    const at = (t: number) => {
      real = t;
      runner.update();
    };
    return { runner, states, at };
  };

  it('counts down 5 s, then runs the timeline with the clock', () => {
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
