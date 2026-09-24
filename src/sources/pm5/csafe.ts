// CSAFE framing for the PM5 over USB (WebHID). Pure functions.
// Follows the working USB code in demo/public/csafe.js.

export const FRAME_START = 0xf1;
export const FRAME_END = 0xf2;
export const FRAME_STUFF = 0xf3;

/** Standard CSAFE short commands. Responses are LE values followed by a unit byte. */
export const CMD = {
  getStatus: 0x80,
  getPace: 0xa6, // u16 s/km
  getCadence: 0xa7, // u16 strokes/min
  getHeartRate: 0xb0, // u8 bpm
  getPower: 0xb4, // u16 W, power of the last stroke
  /** Wrapper for PM-proprietary commands (CSAFE_SETUSERCFG1_CMD). */
  pmWrapper: 0x1a,
} as const;

/** PM-proprietary short pull-data commands, sent inside CMD.pmWrapper. */
export const PM = {
  workoutState: 0x8d, // u8
  workTime: 0xa0, // u32 LE in 0.01 s + fraction byte
  workDistance: 0xa3, // u32 LE in 0.1 m + fraction byte
  strokeState: 0xbf, // u8 StrokeState
  dragFactor: 0xc1, // u8
} as const;

export const StrokeState = {
  waitingForWheelMinSpeed: 0,
  waitingForWheelAccelerate: 1,
  driving: 2,
  dwellingAfterDrive: 3,
  recovery: 4,
} as const;

/**
 * Frame with standard commands plus PM commands in a 0x1A wrapper:
 * start byte, stuffed payload, XOR checksum, end byte.
 */
export function buildFrame(std: readonly number[], pm: readonly number[] = []): Uint8Array {
  const payload = pm.length > 0 ? [...std, CMD.pmWrapper, pm.length, ...pm] : [...std];
  let checksum = 0;
  for (const b of payload) checksum ^= b;
  const out = [FRAME_START];
  for (const b of [...payload, checksum]) {
    if (b >= FRAME_START - 1 && b <= FRAME_STUFF) out.push(FRAME_STUFF, b - 0xf0);
    else out.push(b);
  }
  out.push(FRAME_END);
  return new Uint8Array(out);
}

export interface CsafeResponse {
  status: number;
  /** Standard command responses by command. */
  std: Map<number, Uint8Array>;
  /** PM command responses (from the 0x1A wrapper) by PM command. The code ranges overlap with std. */
  pm: Map<number, Uint8Array>;
}

/**
 * Finds the first complete frame in `bytes` (trailing zero padding from the HID
 * report is ignored), unstuffs it, checks the checksum and splits the responses.
 * Returns null when there is no complete frame.
 */
export function parseFrame(bytes: Uint8Array): CsafeResponse | null {
  const start = bytes.indexOf(FRAME_START);
  if (start < 0) return null;
  const end = bytes.indexOf(FRAME_END, start + 1);
  if (end < 0) return null;

  const body: number[] = [];
  for (let i = start + 1; i < end; i++) {
    const b = bytes[i]!;
    if (b === FRAME_STUFF && i + 1 < end) body.push(0xf0 + bytes[++i]!);
    else body.push(b);
  }
  if (body.length < 2) return null;

  const checksum = body.pop()!;
  let calc = 0;
  for (const b of body) calc ^= b;
  if (calc !== checksum) throw new Error(`CSAFE checksum ${hex(checksum)}, expected ${hex(calc)}`);

  const [status, ...rest] = body;
  const std = parseCommands(rest);
  const wrapped = std.get(CMD.pmWrapper);
  std.delete(CMD.pmWrapper);
  return { status: status!, std, pm: wrapped ? parseCommands(wrapped) : new Map() };
}

/** [cmd, len, data…]* */
function parseCommands(bytes: ArrayLike<number>): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  let i = 0;
  while (i + 1 < bytes.length) {
    const cmd = bytes[i]!;
    const len = bytes[i + 1]!;
    if (i + 2 + len > bytes.length) throw new Error(`CSAFE response for ${hex(cmd)} is truncated`);
    out.set(cmd, Uint8Array.from({ length: len }, (_, k) => bytes[i + 2 + k]!));
    i += 2 + len;
  }
  return out;
}

/** Little-endian unsigned integer from the first `n` bytes; undefined when too short. */
export function uintLE(bytes: Uint8Array | undefined, n: number): number | undefined {
  if (!bytes || bytes.length < n) return undefined;
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + bytes[i]!;
  return v;
}

const hex = (b: number): string => `0x${b.toString(16).padStart(2, '0')}`;
