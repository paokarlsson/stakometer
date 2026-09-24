// Synthetic payloads built from the layouts in spec §9.3.
// Replace/extend with hex fixtures from a real PM5 in tests/fixtures/ (step 0).
import { describe, expect, it } from 'vitest';
import {
  fromHex,
  parseAdditionalStatus,
  parseAdditionalStatus2,
  parseAdditionalStrokeData,
  parseGeneralStatus,
  parseStrokeData,
  toHex,
} from '../src/sources/pm5/parse';

const le = (value: number, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => (value >> (8 * i)) & 0xff);
const view = (...parts: number[][]): DataView => new DataView(new Uint8Array(parts.flat()).buffer);

describe('parseGeneralStatus (0031)', () => {
  it('reads elapsed, distance, states and drag factor', () => {
    const v = view(le(123456, 3), le(56789, 3), [1, 2, 3, 1, 4], le(2000, 3), le(60000, 3), [0x80], [110]);
    expect(parseGeneralStatus(v)).toEqual({
      elapsed: expect.closeTo(1234.56, 6),
      distance: expect.closeTo(5678.9, 6),
      workoutType: 1,
      intervalType: 2,
      workoutState: 3,
      rowingState: 1,
      strokeState: 4,
      totalWorkDistance: 2000,
      workoutDuration: 60000,
      durationType: 0x80,
      dragFactor: 110,
    });
  });

  it('rejects short payloads', () => {
    expect(() => parseGeneralStatus(view([1, 2, 3]))).toThrow(RangeError);
  });
});

describe('parseAdditionalStatus (0032)', () => {
  const base = (hr: number, extra: number[] = []) =>
    view(le(6000, 3), le(4200, 2), [32], [hr], le(12050, 2), le(12500, 2), le(0, 2), le(0, 3), extra);

  it('reads speed, stroke rate, heart rate and pace', () => {
    const a = parseAdditionalStatus(base(142));
    expect(a.elapsed).toBeCloseTo(60);
    expect(a.speed).toBeCloseTo(4.2);
    expect(a.strokeRate).toBe(32);
    expect(a.heartRate).toBe(142);
    expect(a.currentPace).toBeCloseTo(120.5);
    expect(a.averagePace).toBeCloseTo(125);
  });

  it('treats heart rate 255 as missing', () => {
    expect(parseAdditionalStatus(base(255)).heartRate).toBeNull();
  });

  it('reads machine type only when byte 16 is present', () => {
    expect(parseAdditionalStatus(base(0)).machineType).toBeNull();
    expect(parseAdditionalStatus(base(0, [7])).machineType).toBe(7);
  });
});

describe('parseAdditionalStatus2 (0033)', () => {
  it('reads average power', () => {
    const v = view(le(100, 3), [2], le(245, 2), le(80, 2), le(12000, 2), le(250, 2), le(900, 2), le(300, 3), le(500, 3));
    const a = parseAdditionalStatus2(v);
    expect(a.intervalCount).toBe(2);
    expect(a.averagePower).toBe(245);
    expect(a.splitAvgPower).toBe(250);
    expect(a.lastSplitDistance).toBe(500);
  });
});

describe('parseStrokeData (0035)', () => {
  it('reads stroke fields in app units', () => {
    const v = view(le(1000, 3), le(1234, 3), [140], [65], le(110, 2), le(1050, 2), le(2500, 2), le(1400, 2), le(3456, 2), le(77, 2));
    const s = parseStrokeData(v);
    expect(s.elapsed).toBeCloseTo(10);
    expect(s.distance).toBeCloseTo(123.4);
    expect(s.driveLength).toBeCloseTo(1.4);
    expect(s.driveTime).toBeCloseTo(0.65);
    expect(s.recoveryTime).toBeCloseTo(1.1);
    expect(s.strokeDistance).toBeCloseTo(10.5);
    expect(s.peakDriveForce).toBeCloseTo(250);
    expect(s.avgDriveForce).toBeCloseTo(140);
    expect(s.workPerStroke).toBeCloseTo(345.6);
    expect(s.strokeCount).toBe(77);
  });
});

describe('parseAdditionalStrokeData (0036)', () => {
  it('reads power per stroke and stroke count little-endian', () => {
    const v = view(le(4550, 3), le(312, 2), le(1100, 2), le(258, 2), le(1800, 3), le(5000, 3));
    expect(parseAdditionalStrokeData(v)).toEqual({
      elapsed: expect.closeTo(45.5, 6),
      power: 312,
      strokeCalories: 1100,
      strokeCount: 258,
      projectedWorkTime: 1800,
      projectedWorkDistance: 5000,
    });
  });

  it('parses from hex as logged', () => {
    const v = fromHex('c6 11 00 38 01 4c 04 02 01 08 07 00 88 13 00');
    expect(parseAdditionalStrokeData(v).power).toBe(312);
    expect(toHex(v)).toBe('c6 11 00 38 01 4c 04 02 01 08 07 00 88 13 00');
  });
});
