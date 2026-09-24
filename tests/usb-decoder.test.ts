import { describe, expect, it } from 'vitest';
import { CMD, PM, StrokeState, type CsafeResponse } from '../src/sources/pm5/csafe';
import { UsbDecoder } from '../src/sources/pm5/usb';

const le = (v: number, n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => Math.floor(v / 256 ** i) % 256));

/** The 50 ms poll: GETPOWER + stroke state. */
const fast = (state: number, power = 0): CsafeResponse => ({
  status: 1,
  std: new Map([[CMD.getPower, le(power, 3)]]),
  pm: new Map([[PM.strokeState, new Uint8Array([state])]]),
});

/** The 250 ms poll. */
function metrics(state: number, o: { time?: number; dist?: number; pace?: number; rate?: number; hr?: number; power?: number } = {}): CsafeResponse {
  return {
    status: 1,
    std: new Map([
      [CMD.getPace, le(o.pace ?? 241, 3)],
      [CMD.getCadence, le(o.rate ?? 36, 3)],
      [CMD.getPower, le(o.power ?? 0, 3)],
      [CMD.getHeartRate, new Uint8Array([o.hr ?? 0])],
    ]),
    pm: new Map([
      [PM.workTime, le(o.time ?? 1234, 5)],
      [PM.workDistance, le(o.dist ?? 5678, 5)],
      [PM.strokeState, new Uint8Array([state])],
      [PM.dragFactor, new Uint8Array([95])],
    ]),
  };
}

describe('UsbDecoder', () => {
  it('converts the metrics poll to a status sample in app units', () => {
    const { status } = new UsbDecoder().handle(metrics(StrokeState.recovery, { hr: 150 }), 7);
    expect(status).toEqual({ ts: 7, pmElapsed: 12.34, distance: 567.8, strokeRate: 36, heartRate: 150, paceSecPer500: 120.5 });
  });

  it('gives no status from the fast poll', () => {
    expect(new UsbDecoder().handle(fast(StrokeState.driving), 0).status).toBeNull();
  });

  it('drops heart rate 0 and 255 and pace 0', () => {
    const d = new UsbDecoder();
    expect(d.handle(metrics(0, { hr: 0, pace: 0 }), 0).status).not.toHaveProperty('heartRate');
    expect(d.handle(metrics(0, { hr: 255 }), 0).status).not.toHaveProperty('heartRate');
    expect(d.handle(metrics(0, { pace: 0 }), 0).status).not.toHaveProperty('paceSecPer500');
  });

  it('counts a stroke when the drive ends and takes power from the next response', () => {
    const d = new UsbDecoder();
    d.handle(metrics(StrokeState.recovery, { time: 6000, dist: 2500, rate: 40 }), 0);
    expect(d.handle(fast(StrokeState.driving, 150), 1).stroke).toBeNull();
    expect(d.handle(fast(StrokeState.driving, 150), 2).stroke).toBeNull();
    expect(d.handle(fast(StrokeState.dwellingAfterDrive, 150), 3).stroke).toBeNull(); // drive ended here
    expect(d.handle(fast(StrokeState.recovery, 287), 4).stroke).toEqual({
      ts: 4,
      pmElapsed: 60,
      power: 287,
      strokeRate: 40,
      strokeCount: 1,
      distance: 250,
      raw: { dragFactor: 95 },
    });
    expect(d.handle(fast(StrokeState.recovery, 287), 5).stroke).toBeNull();
  });

  it('counts one stroke per drive', () => {
    const d = new UsbDecoder();
    const states = [0, 1, 2, 2, 3, 4, 4, 2, 4, 4, 2, 2, 3, 4];
    const strokes = states.map((s, i) => d.handle(fast(s, 200), i).stroke).filter((s) => s !== null);
    expect(strokes.map((s) => s.strokeCount)).toEqual([1, 2, 3]);
  });

  it('waits with the stroke until a response carries power', () => {
    const d = new UsbDecoder();
    d.handle(fast(StrokeState.driving), 0);
    d.handle(fast(StrokeState.recovery), 1);
    const noPower: CsafeResponse = { status: 1, std: new Map(), pm: new Map([[PM.strokeState, new Uint8Array([4])]]) };
    expect(d.handle(noPower, 2).stroke).toBeNull();
    expect(d.handle(fast(StrokeState.recovery, 250), 3).stroke?.power).toBe(250);
  });
});
