// Pure parsers for PM5 BLE notifications (spec §9.3). All fields little-endian.
// Output is in app units: seconds, metres, watts.
// [VERIFY] Layouts are from the spec and ErgometerJS, not yet confirmed against a real PM5.

const u8 = (v: DataView, i: number): number => v.getUint8(i);
const u16 = (v: DataView, i: number): number => v.getUint16(i, true);
const u24 = (v: DataView, i: number): number => v.getUint8(i) | (v.getUint8(i + 1) << 8) | (v.getUint8(i + 2) << 16);

const CS = 0.01; // time unit, s
const DM = 0.1; // distance unit, m

function requireLength(v: DataView, min: number, name: string): void {
  if (v.byteLength < min) throw new RangeError(`${name}: expected ≥${min} bytes, got ${v.byteLength}`);
}

/** 0031 General status. */
export interface GeneralStatus {
  elapsed: number;
  distance: number;
  workoutType: number;
  intervalType: number;
  workoutState: number;
  rowingState: number;
  strokeState: number;
  totalWorkDistance: number;
  workoutDuration: number; // raw: time (0.01 s) or distance depending on durationType
  durationType: number;
  dragFactor: number;
}

export function parseGeneralStatus(v: DataView): GeneralStatus {
  requireLength(v, 19, '0031');
  return {
    elapsed: u24(v, 0) * CS,
    distance: u24(v, 3) * DM,
    workoutType: u8(v, 6),
    intervalType: u8(v, 7),
    workoutState: u8(v, 8),
    rowingState: u8(v, 9),
    strokeState: u8(v, 10),
    totalWorkDistance: u24(v, 11),
    workoutDuration: u24(v, 14),
    durationType: u8(v, 17),
    dragFactor: u8(v, 18),
  };
}

/** 0032 Additional status. */
export interface AdditionalStatus {
  elapsed: number;
  speed: number; // m/s
  strokeRate: number;
  heartRate: number | null; // null when the PM5 reports 255 (invalid)
  currentPace: number; // s/500 m
  averagePace: number; // s/500 m
  restDistance: number; // m
  restTime: number; // s
  machineType: number | null; // byte 16, absent in ErgometerJS's 16-byte layout
}

export const INVALID_HEART_RATE = 255;

export function parseAdditionalStatus(v: DataView): AdditionalStatus {
  requireLength(v, 16, '0032');
  const hr = u8(v, 6);
  return {
    elapsed: u24(v, 0) * CS,
    speed: u16(v, 3) * 0.001,
    strokeRate: u8(v, 5),
    heartRate: hr === INVALID_HEART_RATE ? null : hr,
    currentPace: u16(v, 7) * CS,
    averagePace: u16(v, 9) * CS,
    restDistance: u16(v, 11),
    restTime: u24(v, 13) * CS,
    machineType: v.byteLength > 16 ? u8(v, 16) : null,
  };
}

/** 0033 Additional status 2. */
export interface AdditionalStatus2 {
  elapsed: number;
  intervalCount: number;
  averagePower: number; // W
  totalCalories: number;
  splitAvgPace: number; // s/500 m
  splitAvgPower: number; // W
  splitAvgCalories: number; // cal/h
  lastSplitTime: number; // s
  lastSplitDistance: number; // m
}

export function parseAdditionalStatus2(v: DataView): AdditionalStatus2 {
  requireLength(v, 20, '0033');
  return {
    elapsed: u24(v, 0) * CS,
    intervalCount: u8(v, 3),
    averagePower: u16(v, 4),
    totalCalories: u16(v, 6),
    splitAvgPace: u16(v, 8) * CS,
    splitAvgPower: u16(v, 10),
    splitAvgCalories: u16(v, 12),
    lastSplitTime: u24(v, 14) * 0.1,
    lastSplitDistance: u24(v, 17),
  };
}

/** 0035 Stroke data. Stored in StrokeSample.raw only. */
export interface StrokeData {
  elapsed: number;
  distance: number;
  driveLength: number; // m
  driveTime: number; // s
  recoveryTime: number; // s
  strokeDistance: number; // m
  peakDriveForce: number; // lbf
  avgDriveForce: number; // lbf
  workPerStroke: number; // J
  strokeCount: number;
}

export function parseStrokeData(v: DataView): StrokeData {
  requireLength(v, 20, '0035');
  return {
    elapsed: u24(v, 0) * CS,
    distance: u24(v, 3) * DM,
    driveLength: u8(v, 6) * 0.01,
    driveTime: u8(v, 7) * CS,
    recoveryTime: u16(v, 8) * CS,
    strokeDistance: u16(v, 10) * 0.01,
    peakDriveForce: u16(v, 12) * 0.1,
    avgDriveForce: u16(v, 14) * 0.1,
    workPerStroke: u16(v, 16) * 0.1,
    strokeCount: u16(v, 18),
  };
}

/** 0036 Additional stroke data – carries power per stroke. */
export interface AdditionalStrokeData {
  elapsed: number;
  power: number; // W
  strokeCalories: number; // cal/h
  strokeCount: number;
  projectedWorkTime: number | null; // s; null when the payload is shorter (multiplexed)
  projectedWorkDistance: number | null; // m
}

/** Layout confirmed by demo/ against a real PM5 for bytes 0–8. */
export function parseAdditionalStrokeData(v: DataView): AdditionalStrokeData {
  requireLength(v, 9, '0036');
  const full = v.byteLength >= 15;
  return {
    elapsed: u24(v, 0) * CS,
    power: u16(v, 3),
    strokeCalories: u16(v, 5),
    strokeCount: u16(v, 7),
    projectedWorkTime: full ? u24(v, 9) : null,
    projectedWorkDistance: full ? u24(v, 12) : null,
  };
}

/** Hex dump used for debug logging and fixtures. */
export function toHex(v: DataView): string {
  return Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function fromHex(hex: string): DataView {
  const bytes = hex.trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
  return new DataView(new Uint8Array(bytes).buffer);
}
