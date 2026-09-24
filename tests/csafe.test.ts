import { describe, expect, it } from 'vitest';
import { buildFrame, CMD, parseFrame, PM, uintLE } from '../src/sources/pm5/csafe';

const xor = (bytes: number[]) => bytes.reduce((a, b) => a ^ b, 0);

describe('buildFrame', () => {
  it('adds start byte, checksum and end byte', () => {
    expect([...buildFrame([CMD.getStatus])]).toEqual([0xf1, 0x80, 0x80, 0xf2]);
  });

  it('puts PM commands in a 0x1A wrapper after the standard commands', () => {
    const payload = [0xb4, 0x1a, 1, 0xbf];
    expect([...buildFrame([CMD.getPower], [PM.strokeState])]).toEqual([0xf1, ...payload, xor(payload), 0xf2]);
  });

  it('stuffs bytes 0xF0–0xF3, including the checksum', () => {
    // payload XOR = 0xF1, so the checksum itself must be stuffed
    expect([...buildFrame([0xf0, 0x01])]).toEqual([0xf1, 0xf3, 0x00, 0x01, 0xf3, 0x01, 0xf2]);
  });
});

describe('parseFrame', () => {
  const frame = (body: number[], pad = 0) => new Uint8Array([0xf1, ...body, xor(body), 0xf2, ...Array(pad).fill(0)]);

  it('keeps standard and PM responses apart even when codes overlap', () => {
    // GETPOWER 312 W (+ unit byte), and PM work time (0xA0, same code as a standard command)
    const body = [0x81, 0xb4, 3, 0x38, 0x01, 0x58, 0x1a, 9, 0xbf, 1, 2, 0xa0, 4, 0x10, 0x27, 0, 0];
    const r = parseFrame(frame(body, 20))!;
    expect(r.status).toBe(0x81);
    expect(uintLE(r.std.get(CMD.getPower), 2)).toBe(312);
    expect([...r.pm.get(PM.strokeState)!]).toEqual([2]);
    expect(uintLE(r.pm.get(PM.workTime), 4)).toBe(10000);
    expect(r.std.has(0xa0)).toBe(false);
    expect(r.std.has(CMD.pmWrapper)).toBe(false);
  });

  it('unstuffs data', () => {
    const body = [0x01, 0x1a, 3, 0xc1, 1, 0xf2];
    const stuffed = [0xf1, 0x01, 0x1a, 3, 0xc1, 1, 0xf3, 0x02, xor(body), 0xf2];
    expect([...parseFrame(new Uint8Array(stuffed))!.pm.get(PM.dragFactor)!]).toEqual([0xf2]);
  });

  it('parses a frame without PM commands', () => {
    const r = parseFrame(frame([0x01, 0xb0, 1, 142]))!;
    expect([...r.std.get(CMD.getHeartRate)!]).toEqual([142]);
    expect(r.pm.size).toBe(0);
  });

  it('rejects a bad checksum and truncated data, returns null for incomplete frames', () => {
    expect(() => parseFrame(new Uint8Array([0xf1, 0x01, 0xb0, 1, 90, 0x00, 0xf2]))).toThrow(/checksum/);
    expect(() => parseFrame(frame([0x01, 0xb4, 3, 0x38]))).toThrow(/truncated/);
    expect(parseFrame(new Uint8Array([0xf1, 0x01, 0xb0]))).toBeNull();
    expect(parseFrame(new Uint8Array([0, 0, 0]))).toBeNull();
  });
});

describe('uintLE', () => {
  it('reads little-endian values and rejects short input', () => {
    expect(uintLE(new Uint8Array([0x78, 0x56, 0x34, 0x12]), 4)).toBe(0x12345678);
    expect(uintLE(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 4)).toBe(0xffffffff);
    expect(uintLE(new Uint8Array([1]), 2)).toBeUndefined();
    expect(uintLE(undefined, 1)).toBeUndefined();
  });
});
