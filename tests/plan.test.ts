// Planned workouts from elitledet (plan.md §4.1, spec §6.7). The example file is written by
// elitledet's `python -m planering` and must stay identical to elitledet's
// tests/fixtures/plan-exempel.json.
import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/core/clock';
import { LiveSession } from '../src/session/live';
import { Simulator, seededRandom } from '../src/sources/simulator';
import { exportBackup, parseBackup, STORE_NAMES, type BackupTarget, type StoreName } from '../src/storage/backup';
import { calibrationOptions, DEFAULT_SETTINGS } from '../src/storage/settings';
import type { Session } from '../src/storage/types';
import { outline, targetText } from '../src/ui/outline';
import { calibrate } from '../src/workout/calibrate';
import { expand, totalDuration } from '../src/workout/expand';
import { heartRateShare, isIsoDate, parsePlan, plannedForList, type PlannedWorkout } from '../src/workout/plan';
import { isStructured, maxEffortDuration, parseWorkout, usesPctCP } from '../src/workout/schema';
import example from './fixtures/plan/plan-exempel.json';
import { MemoryStore } from './helpers/memoryStore';

const sig = { pp: 610, cp: 215, wPrime: 16500 };
const clone = (): Record<string, any> => structuredClone(example) as Record<string, any>;

describe('parsePlan', () => {
  const plan = parsePlan(example, '2026-10-04T18:00:00.000Z');
  const [easy, vo2, tempo, surges] = plan.workouts as [PlannedWorkout, PlannedWorkout, PlannedWorkout, PlannedWorkout];

  it('reads the example from elitledet', () => {
    expect(plan.athlete).toEqual({ maxHR: 188, thresholdHR: 168, restingHR: 44, weight: 82.5, pp: 610, cp: 215, wPrime: 16500, dragFactor: 110, asOf: '2026-10-04' });
    expect(plan.workouts.map((w) => [w.id, w.date])).toEqual([
      ['2026-10-05-lugnt-teknikpass', '2026-10-05'],
      ['2026-10-06-5x4-min-vo2peak', '2026-10-06'],
      ['2026-10-08-tempo-3x15-min', '2026-10-08'],
      ['2026-10-10-ryck-i-klunga', '2026-10-10'],
    ]);
    expect(plan.workouts.every((w) => w.athlete === plan.athlete && w.importedAt === '2026-10-04T18:00:00.000Z')).toBe(true);
    expect(vo2.calibration).toEqual({ mode: 'fit', minWbal: 0.3 });
    expect(surges.calibration).toEqual({ mode: 'lower', minWbal: 0.2 });
    expect(tempo.calibration).toBeUndefined();
  });

  it('keeps an unstructured workout as a description without segments', () => {
    expect(isStructured(easy)).toBe(false);
    expect(easy.description).toMatch(/hög höft/);
    expect(expand(easy, sig)).toEqual([]);
    expect(usesPctCP(easy)).toBe(false);
    expect(maxEffortDuration(easy)).toBeNull();
  });

  it('rejects a bad file as a whole with a readable message', () => {
    expect(() => parsePlan({ format: 'skierg-backup' })).toThrow(/ingen plan/);
    expect(() => parsePlan({ ...clone(), version: 2 })).toThrow(/version 2/);
    expect(() => parsePlan({ ...clone(), workouts: [] })).toThrow(/saknar pass/);
    const bad = (change: (p: Record<string, any>) => void) => {
      const p = clone();
      change(p);
      return () => parsePlan(p);
    };
    expect(bad((p) => (p.workouts[1].date = '2026-02-30'))).toThrow(/Pass 2 .*date/);
    expect(bad((p) => (p.workouts[1].id = p.workouts[0].id))).toThrow(/id finns redan/);
    expect(bad((p) => (p.workouts[1].calibration = { mode: 'auto' }))).toThrow(/calibration.mode/);
    expect(bad((p) => (p.workouts[1].calibration = { mode: 'fit', minWbal: 30 }))).toThrow(/minWbal/);
    expect(bad((p) => (p.workouts[1].segments = []))).toThrow(/ostrukturerat/);
    expect(bad((p) => (p.workouts[3].segments[1].segments[1].duration = 0))).toThrow(/segment 2\.2: duration/);
    expect(bad((p) => (p.workouts[1].segments[1].description = ''))).toThrow(/description/);
    expect(bad((p) => (p.athlete.pp = 200))).toThrow(/pp måste vara större än cp/);
    expect(bad((p) => (p.athlete.thresholdHR = 190))).toThrow(/thresholdHR/);
    expect(bad((p) => (p.athlete.cp = 'hög'))).toThrow(/athlete.cp/);
  });

  it('ignores athlete values it does not know, so elitledet can add more', () => {
    const p = clone();
    p.athlete.ftp = 250;
    expect(parsePlan(p).athlete).not.toHaveProperty('ftp');
  });
});

describe('blocks and descriptions (§6.1)', () => {
  const [, vo2, tempo, surges] = parsePlan(example).workouts as PlannedWorkout[];

  it('expands a warm-up block with its description on every segment that has none', () => {
    const t = expand(vo2!, sig);
    expect(t.slice(0, 5).map((s) => [s.block, s.label, s.description])).toEqual([
      ['Uppvärmning', 'Lugnt', 'Lugnt, med två korta ökningar mot slutet.'],
      ['Uppvärmning', 'Ökning · 1/2', 'Lugnt, med två korta ökningar mot slutet.'],
      ['Uppvärmning', 'Vila', 'Lugnt, med två korta ökningar mot slutet.'],
      ['Uppvärmning', 'Ökning · 2/2', 'Lugnt, med två korta ökningar mot slutet.'],
      ['Uppvärmning', 'Lugnt', 'Lugnt, med två korta ökningar mot slutet.'],
    ]);
    // A segment's own description, and its rest's, outside the block.
    expect(t[5]).toMatchObject({ label: 'Intervall 1/5', description: 'Jämnt tryck, samma takt hela vägen.' });
    expect(t[5]).not.toHaveProperty('block');
    expect(t[6]).toMatchObject({ kind: 'rest', description: 'Aktiv vila, släpp axlarna.' });
    expect(t.at(-1)).toMatchObject({ kind: 'cooldown', targetW: null, description: 'Lugnt, valfri teknik.' });
    expect(totalDuration(t)).toBe(670 + 5 * 240 + 4 * 180 + 600);
  });

  it('turns a range into a midpoint and a tolerance', () => {
    const interval = expand(tempo!, sig)[1]!;
    expect(interval.targetW).toBeCloseTo(215 * 0.915);
    expect(interval.lo! / 215).toBeCloseTo(0.88, 2);
    expect(interval.hi! / 215).toBeCloseTo(0.95, 2);
  });

  it('repeats a nested block and names each lap', () => {
    const t = expand(surges!, sig);
    const surgesOnly = t.filter((s) => s.label === 'Ryck');
    expect(surgesOnly).toHaveLength(12);
    expect(surgesOnly[2]).toMatchObject({ block: 'Klunga 3/12', description: 'Full kraft i stavarna.' });
    expect(t[1]).toMatchObject({ block: 'Klunga 1/12', label: 'Jämnt', description: 'Lugnt i klungan tills det är dags att rycka.' });
    expect(totalDuration(t)).toBe(600 + 12 * 420 + 600);
  });

  it('puts the rest between block repetitions outside the block', () => {
    const w = parseWorkout({
      id: 'x',
      name: '3×10 40/20',
      segments: [
        {
          kind: 'block',
          label: 'Serie',
          repeat: 3,
          description: 'Håll takten',
          rest: { duration: 180, target: { pctCP: 40 } },
          segments: [{ kind: 'interval', duration: 40, target: { pctCP: 120 }, repeat: 10, rest: { duration: 20, target: { pctCP: 40 } } }],
        },
      ],
    });
    const t = expand(w, { cp: 200 });
    expect(t).toHaveLength(3 * 19 + 2);
    expect(t[19]).toMatchObject({ kind: 'rest', start: 580, end: 760, label: 'Vila' });
    expect(t[19]).not.toHaveProperty('block');
    expect(t[19]).not.toHaveProperty('description');
    expect(t[20]).toMatchObject({ block: 'Serie 2/3', label: 'Intervall 1/10', description: 'Håll takten', targetW: 240 });
    expect(usesPctCP(w)).toBe(true);
  });

  it('finds a maximal effort inside a block', () => {
    const w = parseWorkout({ id: 't', name: 'T', segments: [{ kind: 'block', segments: [{ kind: 'test', duration: 180, target: { max: true } }] }] });
    expect(maxEffortDuration(w)).toBe(180);
    expect(expand(w, null)[0]).not.toHaveProperty('block'); // an unlabelled single block adds no name
  });

  it('rejects blocks nested too deep', () => {
    let step: Record<string, unknown> = { kind: 'steady', duration: 60, target: null };
    for (let i = 0; i < 5; i++) step = { kind: 'block', segments: [step] };
    expect(() => parseWorkout({ id: 'x', name: 'X', segments: [step] })).toThrow(/nästlade/);
  });
});

describe('outline on the start page', () => {
  const [, vo2, tempo] = parsePlan(example).workouts as PlannedWorkout[];

  it('writes one line per segment or block', () => {
    expect(outline(vo2!.segments).map((l) => [l.depth, l.text, l.description])).toEqual([
      [0, 'Uppvärmning', 'Lugnt, med två korta ökningar mot slutet.'],
      [1, 'Lugnt 8:00 · 60 % CP', undefined],
      [1, '2 × Ökning 0:10 · 120 % CP, vila 0:50 · 60 % CP', undefined],
      [1, 'Lugnt 2:00 · 60 % CP', undefined],
      [0, '5 × Intervall 4:00 · 108 % CP, vila 3:00 · 45 % CP', 'Jämnt tryck, samma takt hela vägen. · Vila: Aktiv vila, släpp axlarna.'],
      [0, 'Nedvarvning 10:00 · utan mål', 'Lugnt, valfri teknik.'],
    ]);
    expect(outline(tempo!.segments)[1]!.text).toBe('3 × Intervall 15:00 · 88–95 % CP, vila 4:00 · 50 % CP');
  });

  it('writes targets', () => {
    expect(targetText({ pctCP: 91.5 })).toBe('91,5 % CP');
    expect(targetText({ watt: 250 }, 0.04)).toBe('240–260 W');
    expect(targetText({ max: true })).toBe('MAX');
    expect(targetText(null)).toBe('utan mål');
  });
});

describe('list order and heart rate', () => {
  const w = (id: string, date: string) => ({ id, date, name: id, segments: [], importedAt: '' }) as PlannedWorkout;

  it("lists today's workouts first, then upcoming, then the past week", () => {
    const all = [w('old', '2026-09-20'), w('past', '2026-10-04'), w('past2', '2026-10-01'), w('next', '2026-10-09'), w('soon', '2026-10-07'), w('today', '2026-10-06')];
    expect(plannedForList(all, '2026-10-06').map((x) => x.id)).toEqual(['today', 'soon', 'next', 'past', 'past2']);
  });

  it('checks dates', () => {
    expect(isIsoDate('2026-10-06')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-10-6')).toBe(false);
  });

  it('gives heart rate as a share of the threshold, else of the max', () => {
    expect(heartRateShare(151, { thresholdHR: 168, maxHR: 188 })).toEqual({ fraction: 151 / 168, of: 'threshold' });
    expect(heartRateShare(151, { maxHR: 188 })).toEqual({ fraction: 151 / 188, of: 'max' });
    expect(heartRateShare(151, { cp: 215 })).toBeNull();
    expect(heartRateShare(151, undefined)).toBeNull();
  });
});

describe('calibration from the plan (§6.5)', () => {
  const [, vo2] = parsePlan(example).workouts as PlannedWorkout[];

  it('goes before the settings', () => {
    const settings = { ...DEFAULT_SETTINGS, calibration: 'off' as const, minWbal: 0.5 };
    expect(calibrationOptions(settings, vo2!.calibration)).toMatchObject({ mode: 'fit', minFraction: 0.3 });
    expect(calibrationOptions(settings, { mode: 'lower' })).toMatchObject({ mode: 'lower', minFraction: 0.5 });
    expect(calibrationOptions(settings)).toMatchObject({ mode: 'off', minFraction: 0.5 });
  });
});

/** In-memory database for the backup, keyed like the real stores. */
class MemoryDb implements BackupTarget {
  readonly dbVersion = 2;
  readonly stores = new Map<StoreName, unknown[]>(STORE_NAMES.map((n) => [n, []]));
  async readAll(store: StoreName) {
    return structuredClone(this.stores.get(store)!);
  }
  async writeAll(store: StoreName, records: readonly unknown[]) {
    this.stores.get(store)!.push(...structuredClone(records as unknown[]));
  }
}

// Step 5 in plan.md §7: a file with planned workouts is imported, one of them is run,
// and the backup shows the session with the right workoutId and the watts the calibration gave.
describe('step 5 acceptance', () => {
  it('imports the plan, runs a workout from it, and the backup has the workoutId and the fitted watts', async () => {
    const plan = parsePlan(example);
    expect(plan.workouts.length).toBeGreaterThanOrEqual(3);
    const workout = plan.workouts[1]!; // 5×4 min, calibration fit 30 %
    const settings = { ...DEFAULT_SETTINGS, calibration: 'off' as const }; // the plan's calibration must win

    // What the live view does at the start (src/ui/views/live.ts).
    const planned = expand(workout, sig, settings.tolerance);
    const fitted = calibrate(planned, sig, calibrationOptions(settings, workout.calibration));
    expect(fitted.scale).not.toBe(1);
    expect(fitted.minWbal.fraction).toBeCloseTo(0.3, 2);

    let real = 0;
    const clock = new SimClock(20, () => real);
    const store = new MemoryStore();
    let live: LiveSession | null = null;
    const sim = new Simulator(clock, { mode: 'followTarget', random: seededRandom(5), tickMs: 0, target: () => live?.runner.target() ?? null });
    await sim.connect();
    const signature = { id: 'sig', machine: 'skierg' as const, ...sig, createdAt: '2026-10-02T10:00:00Z', source: 'test3p' as const };
    live = new LiveSession(sim, clock, store, { mode: 'workout', workoutId: workout.id, planned: workout, timeline: fitted.timeline, signature });
    await live.start();
    while (live.runner.state !== 'finished') {
      real += 0.05;
      sim.advance(clock.now());
      live.tick();
    }
    const session = await live.stop();
    expect(session.status).toBe('completed');

    const db = new MemoryDb();
    await db.writeAll('sessions', await store.listSessions());
    await db.writeAll('plannedWorkouts', plan.workouts);
    const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(db))));
    const saved = backup.stores.sessions[0] as Session;
    expect(saved.workoutId).toBe('2026-10-06-5x4-min-vo2peak');
    expect(saved.planned?.athlete?.thresholdHR).toBe(168);
    const intervals = saved.timeline!.filter((s) => s.kind === 'interval');
    expect(intervals).toHaveLength(5);
    expect(intervals[0]!.targetW).toBe(fitted.timeline.find((s) => s.kind === 'interval')!.targetW);
    expect(intervals[0]!.targetW).not.toBeCloseTo(215 * 1.08, 0); // the fitted watts, not 108 % of CP
    expect(backup.stores.plannedWorkouts).toHaveLength(4);
  }, 60_000);
});
