import { describe, expect, it } from 'vitest';
import { CADENCE_ZERO_AFTER_S, CadenceTracker, parseCyclingPower } from '../src/sources/bike/cps';
import { fromHex } from '../src/sources/pm5/parse';

describe('Cycling Power Measurement (0x2A63)', () => {
  it('reads power alone', () => {
    expect(parseCyclingPower(fromHex('00 00 c8 00'))).toEqual({ power: 200 });
  });

  it('reads negative power as sint16', () => {
    expect(parseCyclingPower(fromHex('00 00 f6 ff')).power).toBe(-10);
  });

  it('reads pedal balance, torque, wheel and crank revolutions in flag order', () => {
    // flags 0x0035: bits 0, 2, 4, 5
    const d = parseCyclingPower(fromHex('35 00 2c 01 64 40 06 e8 03 00 00 00 08 0a 00 00 04'));
    expect(d).toEqual({
      power: 300,
      pedalBalance: 50,
      accumulatedTorque: 50,
      wheelRevs: 1000,
      wheelEventTime: 1,
      crankRevs: 10,
      crankEventTime: 1024,
    });
  });

  it('reads crank revolutions without the fields before them', () => {
    expect(parseCyclingPower(fromHex('20 00 96 00 ff ff 34 12'))).toEqual({ power: 150, crankRevs: 65_535, crankEventTime: 0x1234 });
  });
});

describe('CadenceTracker', () => {
  it('needs two measurements', () => {
    const c = new CadenceTracker();
    expect(c.update(10, 1024, 0)).toBeNull();
    expect(c.update(11, 1024 + 683, 0.7)).toBeCloseTo(89.96, 1);
  });

  it('handles wrap-around of both revolutions and event time at 65 536', () => {
    const c = new CadenceTracker();
    c.update(65_535, 65_000, 0);
    // 2 revolutions in 1365/1024 s
    expect(c.update(1, (65_000 + 1365) % 65_536, 1.3)).toBeCloseTo(90, 1);
  });

  it('keeps the last cadence while the cranks pause, and gives 0 after about 3 s', () => {
    const c = new CadenceTracker();
    c.update(10, 0, 0);
    c.update(11, 683, 0.7);
    expect(c.update(11, 683, 1.7)).toBeCloseTo(89.96, 1);
    expect(c.update(11, 683, 0.7 + CADENCE_ZERO_AFTER_S - 0.1)).toBeGreaterThan(0);
    expect(c.update(11, 683, 0.7 + CADENCE_ZERO_AFTER_S)).toBe(0);
    // Pedalling again
    expect(c.update(12, 683 + 1024, 4)).toBeCloseTo(60, 1);
  });
});
