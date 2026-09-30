// Planned workouts from elitledet (plan.md §4.1, spec §6.7): a file with workouts in
// the format of §6.1, each with a date and an optional calibration, plus what the
// coach knows about the athlete. Validated as a whole: a bad file imports nothing.
import type { CalibrationMode } from './calibrate';
import { parseWorkout, type Workout } from './schema';

export const PLAN_FORMAT = 'stakometer-plan';
export const PLAN_VERSION = 1;

/** What the coach knew about the athlete when the plan was written. Every field is optional. */
export interface Athlete {
  maxHR?: number; // bpm
  thresholdHR?: number; // bpm, lactate threshold heart rate
  restingHR?: number; // bpm
  weight?: number; // kg
  pp?: number; // W
  cp?: number; // W
  wPrime?: number; // J
  /** Drag factor the workouts should be done at, usually that of the latest tests. */
  dragFactor?: number;
  /** Date the values were collected, YYYY-MM-DD. */
  asOf?: string;
}

/** Overrides the calibration in settings (spec §6.5, §8.5) for one workout. */
export interface PlanCalibration {
  mode: CalibrationMode;
  /** Planned lowest W′ as a fraction of W′; the setting's value when missing. */
  minWbal?: number;
}

export interface PlannedWorkout extends Workout {
  date: string; // YYYY-MM-DD
  calibration?: PlanCalibration;
  /** The plan's athlete values, copied to every workout in the file. */
  athlete?: Athlete;
  importedAt: string; // ISO 8601
}

export interface ParsedPlan {
  athlete: Athlete | null;
  workouts: PlannedWorkout[];
}

const ATHLETE_NUMBERS = ['maxHR', 'thresholdHR', 'restingHR', 'weight', 'pp', 'cp', 'wPrime', 'dragFactor'] as const;
const CALIBRATION_MODES: readonly CalibrationMode[] = ['off', 'lower', 'fit'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** Today (or `d`) as YYYY-MM-DD in local time. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unknown fields are ignored, so elitledet can add values stakometer does not use yet. */
export function parseAthlete(v: unknown): Athlete {
  if (!isObject(v)) throw new Error('athlete måste vara ett objekt');
  const a: Athlete = {};
  for (const key of ATHLETE_NUMBERS) {
    const n = v[key];
    if (n === undefined || n === null) continue;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(`athlete.${key} måste vara ett tal > 0`);
    a[key] = n;
  }
  if (v.asOf !== undefined && v.asOf !== null) {
    if (!isIsoDate(v.asOf)) throw new Error('athlete.asOf måste vara ett datum (ÅÅÅÅ-MM-DD)');
    a.asOf = v.asOf;
  }
  if (a.pp !== undefined && a.cp !== undefined && a.pp <= a.cp) throw new Error('athlete: pp måste vara större än cp');
  if (a.maxHR !== undefined && a.thresholdHR !== undefined && a.thresholdHR >= a.maxHR) throw new Error('athlete: thresholdHR måste vara lägre än maxHR');
  if (a.restingHR !== undefined && a.thresholdHR !== undefined && a.restingHR >= a.thresholdHR) throw new Error('athlete: restingHR måste vara lägre än thresholdHR');
  return a;
}

function parseCalibration(v: unknown, where: string): PlanCalibration {
  if (!isObject(v) || !CALIBRATION_MODES.includes(v.mode as CalibrationMode)) {
    throw new Error(`${where}: calibration.mode måste vara "fit", "lower" eller "off"`);
  }
  const c: PlanCalibration = { mode: v.mode as CalibrationMode };
  if (v.minWbal !== undefined) {
    if (typeof v.minWbal !== 'number' || v.minWbal < 0 || v.minWbal > 0.9) throw new Error(`${where}: calibration.minWbal måste vara en andel mellan 0 och 0,9`);
    c.minWbal = v.minWbal;
  }
  return c;
}

/** Validates unknown JSON as a plan file. Throws with a readable message; nothing is half-parsed. */
export function parsePlan(json: unknown, importedAt = new Date().toISOString()): ParsedPlan {
  if (!isObject(json) || json.format !== PLAN_FORMAT) throw new Error('Filen är ingen plan från elitledet (format "stakometer-plan").');
  if (json.version !== PLAN_VERSION) throw new Error(`Planversion ${String(json.version)} stöds inte.`);
  const athlete = json.athlete === undefined || json.athlete === null ? null : parseAthlete(json.athlete);
  if (!Array.isArray(json.workouts) || json.workouts.length === 0) throw new Error('Planen saknar pass.');

  const seen = new Set<string>();
  const workouts = json.workouts.map((raw, i): PlannedWorkout => {
    const workout = parseWorkout(raw);
    const r = raw as Record<string, unknown>;
    const where = `Pass ${i + 1} (${workout.id})`;
    if (seen.has(workout.id)) throw new Error(`${where}: id finns redan i planen`);
    seen.add(workout.id);
    if (!isIsoDate(r.date)) throw new Error(`${where}: date måste vara ett datum (ÅÅÅÅ-MM-DD)`);
    return {
      ...workout,
      date: r.date,
      ...(r.calibration !== undefined && { calibration: parseCalibration(r.calibration, where) }),
      ...(athlete && { athlete }),
      importedAt,
    };
  });
  return { athlete, workouts };
}

export const isPlanned = (w: Workout | null | undefined): w is PlannedWorkout => !!w && typeof (w as Partial<PlannedWorkout>).date === 'string';

/**
 * The planned workouts to list (plan.md §4.1: the date only sets the order): today's
 * first, then upcoming by date, then the last `pastDays` days, newest first. Older
 * ones stay in the database and the backup but are not listed.
 */
export function plannedForList(all: readonly PlannedWorkout[], today: string, pastDays = 7): PlannedWorkout[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - pastDays);
  const oldest = cutoff.toISOString().slice(0, 10);
  const byDate = (a: PlannedWorkout, b: PlannedWorkout) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  return [
    ...all.filter((w) => w.date === today).sort(byDate),
    ...all.filter((w) => w.date > today).sort(byDate),
    ...all.filter((w) => w.date < today && w.date >= oldest).sort((a, b) => byDate(b, a)),
  ];
}

/** Heart rate as a share of the threshold heart rate, else of the max; null without either. */
export function heartRateShare(hr: number, athlete: Athlete | undefined): { fraction: number; of: 'threshold' | 'max' } | null {
  if (athlete?.thresholdHR) return { fraction: hr / athlete.thresholdHR, of: 'threshold' };
  if (athlete?.maxHR) return { fraction: hr / athlete.maxHR, of: 'max' };
  return null;
}
