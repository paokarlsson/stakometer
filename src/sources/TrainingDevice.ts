// Common device layer: every source, SkiErg or bike, also gives normalized measurements.
// The recorder and the W′ model keep using the raw strokes and statuses; the live values
// (cadence, speed, force, heart rate) are read from here. A value the device does not
// send is null, never made up.
import type { Unsubscribe } from '../core/events';
import { sportOf, type DataSource, type Sport, type StatusSample, type StrokeSample } from './DataSource';

export const LBF_TO_N = 4.448222;

export interface Measurement {
  ts: number; // Clock.now() when received
  power: number | null; // W
  /** strokes/min on the SkiErg, crank rpm on a bike. */
  cadence: number | null;
  speed: number | null; // m/s
  distance: number | null; // m, total as the device counts it
  elapsed: number | null; // s, the device's own clock
  heartRate: number | null; // bpm
  /** Average drive force per stroke, N (SkiErg over Bluetooth). */
  force: number | null;
  /** Crank torque, Nm (bike): measured power / angular velocity of the measured cadence. */
  torque: number | null;
}

export interface TrainingDevice extends DataSource {
  onMeasurement(cb: (m: Measurement) => void): Unsubscribe;
}

const orNull = (v: number | undefined): number | null => (v === undefined || !Number.isFinite(v) ? null : v);

/** Torque from power and cadence; null without a cadence above 0. */
export function torqueFrom(power: number | null, cadence: number | null): number | null {
  if (power === null || cadence === null || cadence <= 0) return null;
  return power / ((2 * Math.PI * cadence) / 60);
}

/** Merges the latest stroke and status into one measurement. */
export function toMeasurement(ts: number, sport: Sport, stroke: StrokeSample | null, status: StatusSample | null): Measurement {
  const power = stroke ? stroke.power : null;
  const strokeRate = stroke && stroke.strokeRate > 0 ? stroke.strokeRate : null;
  const cadence = orNull(status?.strokeRate) ?? strokeRate;
  const avgDriveForce = orNull(stroke?.raw?.avgDriveForce);
  return {
    ts,
    power,
    cadence,
    speed: orNull(status?.speed),
    distance: orNull(status?.distance) ?? orNull(stroke?.distance),
    elapsed: status?.pmElapsed ?? stroke?.pmElapsed ?? null,
    heartRate: orNull(status?.heartRate),
    force: sport === 'skierg' && avgDriveForce !== null ? avgDriveForce * LBF_TO_N : null,
    torque: sport === 'bike' ? torqueFrom(power, cadence) : null,
  };
}

/** Measurements from any DataSource's strokes and statuses, one per stroke or status. */
export function measurements(source: DataSource, cb: (m: Measurement) => void): Unsubscribe {
  let stroke: StrokeSample | null = null;
  let status: StatusSample | null = null;
  const sport = (): Sport => sportOf(source.machine() ?? 'skierg');
  const offs = [
    source.onStroke((s) => {
      stroke = s;
      cb(toMeasurement(s.ts, sport(), stroke, status));
    }),
    source.onStatus((s) => {
      status = s;
      cb(toMeasurement(s.ts, sport(), stroke, status));
    }),
  ];
  return () => offs.forEach((off) => off());
}
