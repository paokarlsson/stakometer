// FTMS Indoor Bike Data (0x2AD2), little-endian: flags (uint16), then each field whose
// bit is set, in bit order. Bit 0 is inverted: 0 means instantaneous speed is present.

export interface IndoorBikeData {
  /** Bit 0 set: the record continues in the next notification. */
  moreData: boolean;
  speed?: number; // km/h
  avgSpeed?: number; // km/h
  cadence?: number; // rpm
  avgCadence?: number; // rpm
  distance?: number; // m, total
  resistance?: number; // unitless level
  power?: number; // W
  avgPower?: number; // W
  energyTotal?: number; // kcal
  energyPerHour?: number; // kcal/h
  energyPerMinute?: number; // kcal/min
  heartRate?: number; // bpm
  met?: number;
  elapsed?: number; // s
  remaining?: number; // s
}

export const FLAG = {
  moreData: 1 << 0,
  avgSpeed: 1 << 1,
  cadence: 1 << 2,
  avgCadence: 1 << 3,
  distance: 1 << 4,
  resistance: 1 << 5,
  power: 1 << 6,
  avgPower: 1 << 7,
  energy: 1 << 8,
  heartRate: 1 << 9,
  met: 1 << 10,
  elapsed: 1 << 11,
  remaining: 1 << 12,
} as const;

/** Throws a RangeError when the value is shorter than its flags say. */
export function parseIndoorBikeData(v: DataView): IndoorBikeData {
  const flags = v.getUint16(0, true);
  let o = 2;
  const u8 = (): number => v.getUint8(o++);
  const u16 = (): number => ((o += 2), v.getUint16(o - 2, true));
  const s16 = (): number => ((o += 2), v.getInt16(o - 2, true));
  const u24 = (): number => ((o += 3), v.getUint16(o - 3, true) | (v.getUint8(o - 1) << 16));
  const has = (bit: number): boolean => (flags & bit) !== 0;

  const d: IndoorBikeData = { moreData: has(FLAG.moreData) };
  if (!has(FLAG.moreData)) d.speed = u16() * 0.01;
  if (has(FLAG.avgSpeed)) d.avgSpeed = u16() * 0.01;
  if (has(FLAG.cadence)) d.cadence = u16() * 0.5;
  if (has(FLAG.avgCadence)) d.avgCadence = u16() * 0.5;
  if (has(FLAG.distance)) d.distance = u24();
  if (has(FLAG.resistance)) d.resistance = s16();
  if (has(FLAG.power)) d.power = s16();
  if (has(FLAG.avgPower)) d.avgPower = s16();
  if (has(FLAG.energy)) {
    d.energyTotal = u16();
    d.energyPerHour = u16();
    d.energyPerMinute = u8();
  }
  if (has(FLAG.heartRate)) d.heartRate = u8();
  if (has(FLAG.met)) d.met = u8() * 0.1;
  if (has(FLAG.elapsed)) d.elapsed = u16();
  if (has(FLAG.remaining)) d.remaining = u16();
  return d;
}

type Fields = Omit<IndoorBikeData, 'moreData'>;

/**
 * Joins a record split over several notifications ("More Data"). Returns the complete record,
 * or null while more is expected. A trainer that sets More Data on every notification still
 * gives records: a field already seen in the pending record starts a new one.
 */
export class IndoorBikeDataJoiner {
  private pending: Fields | null = null;

  push(d: IndoorBikeData): Fields | null {
    const { moreData, ...fields } = d;
    if (moreData) {
      const prev = this.pending;
      if (prev && Object.keys(fields).some((k) => k in prev)) {
        this.pending = fields;
        return prev;
      }
      this.pending = { ...prev, ...fields };
      return null;
    }
    const done = { ...this.pending, ...fields };
    this.pending = null;
    return done;
  }
}
