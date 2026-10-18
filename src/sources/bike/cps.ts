// Cycling Power Measurement (0x2A63), little-endian: flags (uint16), power (sint16, W), then
// the optional fields in flag order. Fields after the crank revolutions are not used.

export interface CyclingPowerData {
  power: number; // W
  pedalBalance?: number; // %, 1/2 resolution
  accumulatedTorque?: number; // Nm, 1/32 resolution
  wheelRevs?: number; // uint32, cumulative
  wheelEventTime?: number; // s, 1/2048 resolution, wraps at 32 s
  crankRevs?: number; // uint16, cumulative
  crankEventTime?: number; // 1/1024 s units, uint16, wraps at 64 s
}

export const CPS_FLAG = {
  pedalBalance: 1 << 0,
  accumulatedTorque: 1 << 2,
  wheelRevs: 1 << 4,
  crankRevs: 1 << 5,
} as const;

export function parseCyclingPower(v: DataView): CyclingPowerData {
  const flags = v.getUint16(0, true);
  const d: CyclingPowerData = { power: v.getInt16(2, true) };
  let o = 4;
  if (flags & CPS_FLAG.pedalBalance) d.pedalBalance = v.getUint8(o++) * 0.5;
  if (flags & CPS_FLAG.accumulatedTorque) {
    d.accumulatedTorque = v.getUint16(o, true) / 32;
    o += 2;
  }
  if (flags & CPS_FLAG.wheelRevs) {
    d.wheelRevs = v.getUint32(o, true);
    d.wheelEventTime = v.getUint16(o + 4, true) / 2048;
    o += 6;
  }
  if (flags & CPS_FLAG.crankRevs) {
    d.crankRevs = v.getUint16(o, true);
    d.crankEventTime = v.getUint16(o + 2, true);
    o += 4;
  }
  return d;
}

/** [FÖRSLAG] Crank revolutions standing still this long means cadence 0. */
export const CADENCE_ZERO_AFTER_S = 3;
const WRAP = 65_536;

/**
 * Cadence from cumulative crank revolutions and event times (1/1024 s), with wrap-around at
 * 65 536 for both. `now` is the receive time in seconds. Null until two measurements have been
 * seen; 0 when the revolutions have not changed for CADENCE_ZERO_AFTER_S.
 */
export class CadenceTracker {
  private last: { revs: number; time: number } | null = null;
  private lastChange: number | null = null;
  private cadence: number | null = null;

  update(revs: number, eventTime: number, now: number): number | null {
    const prev = this.last;
    this.last = { revs, time: eventTime };
    if (!prev) {
      this.lastChange = now;
      return null;
    }
    const dRevs = (revs - prev.revs + WRAP) % WRAP;
    const dTime = (eventTime - prev.time + WRAP) % WRAP;
    if (dRevs > 0 && dTime > 0) {
      this.cadence = (dRevs / (dTime / 1024)) * 60;
      this.lastChange = now;
    } else if (this.lastChange !== null && now - this.lastChange >= CADENCE_ZERO_AFTER_S) {
      this.cadence = 0;
    }
    return this.cadence;
  }

  reset(): void {
    this.last = null;
    this.lastChange = null;
    this.cadence = null;
  }
}
