import { describe, expect, it } from 'vitest';
import { IndoorBikeDataJoiner, parseIndoorBikeData } from '../src/sources/bike/ftms';
import { encodeIndoorBikeData } from '../src/sources/bike/simulator';
import { fromHex } from '../src/sources/pm5/parse';

describe('FTMS Indoor Bike Data (0x2AD2)', () => {
  it('reads speed (bit 0 clear), cadence and power', () => {
    // flags 0x0044: cadence + power; speed present because bit 0 is 0.
    const d = parseIndoorBikeData(fromHex('44 00 54 0b b4 00 fa 00'));
    expect(d).toEqual({ moreData: false, speed: 29, cadence: 90, power: 250 });
  });

  it('reads every field in bit order', () => {
    const d = parseIndoorBikeData(
      fromHex('fe 1f e8 03 84 03 a0 00 96 00 45 23 01 fb ff 2c 01 18 01 7b 00 58 02 0a 91 34 10 0e 3c 00'),
    );
    expect(d.moreData).toBe(false);
    expect(d.speed).toBeCloseTo(10);
    expect(d.avgSpeed).toBeCloseTo(9);
    expect(d).toMatchObject({
      cadence: 80,
      avgCadence: 75,
      distance: 0x012345,
      resistance: -5,
      power: 300,
      avgPower: 280,
      energyTotal: 123,
      energyPerHour: 600,
      energyPerMinute: 10,
      heartRate: 145,
      elapsed: 3600,
      remaining: 60,
    });
    expect(d.met).toBeCloseTo(5.2);
  });

  it('reads negative power as sint16', () => {
    expect(parseIndoorBikeData(fromHex('40 00 00 00 ec ff')).power).toBe(-20);
  });

  it('leaves speed out when bit 0 (More Data) is set', () => {
    const d = parseIndoorBikeData(fromHex('41 00 2c 01'));
    expect(d).toEqual({ moreData: true, power: 300 });
    expect('speed' in d).toBe(false);
  });

  it('gives only the flags when nothing else is set', () => {
    expect(parseIndoorBikeData(fromHex('01 00'))).toEqual({ moreData: true });
  });

  it('throws on a value shorter than its flags say', () => {
    expect(() => parseIndoorBikeData(fromHex('44 00 54 0b b4'))).toThrow(RangeError);
  });

  it('round-trips through the simulator encoder', () => {
    const fields = { speed: 31.5, cadence: 92.5, distance: 12_345, power: 287, elapsed: 61 };
    expect(parseIndoorBikeData(encodeIndoorBikeData(fields))).toEqual({ moreData: false, ...fields });
  });
});

describe('IndoorBikeDataJoiner', () => {
  it('joins a record split over two notifications', () => {
    const j = new IndoorBikeDataJoiner();
    expect(j.push(parseIndoorBikeData(fromHex('41 00 2c 01')))).toBeNull();
    expect(j.push(parseIndoorBikeData(fromHex('04 00 54 0b b4 00')))).toEqual({ power: 300, speed: 29, cadence: 90 });
  });

  it('passes complete records straight through', () => {
    const j = new IndoorBikeDataJoiner();
    expect(j.push(parseIndoorBikeData(fromHex('44 00 54 0b b4 00 fa 00')))).toEqual({ speed: 29, cadence: 90, power: 250 });
    expect(j.push(parseIndoorBikeData(fromHex('40 00 54 0b fb 00')))).toEqual({ speed: 29, power: 251 });
  });

  it('still gives records from a trainer that sets More Data on every notification', () => {
    const j = new IndoorBikeDataJoiner();
    expect(j.push(parseIndoorBikeData(fromHex('41 00 2c 01')))).toBeNull();
    expect(j.push(parseIndoorBikeData(fromHex('41 00 2d 01')))).toEqual({ power: 300 });
    expect(j.push(parseIndoorBikeData(fromHex('41 00 2e 01')))).toEqual({ power: 301 });
  });
});
