// PM5 Bluetooth UUIDs (spec §9.2). Status per UUID is in the spec table.

const uuid = (short: string): string => `ce06${short.toLowerCase()}-43e5-11e4-916c-0800200c9a66`;

export const SERVICE = {
  /** Advertised by the PM5; ErgometerJS scans for this instead of the name. */
  discovery: uuid('0000'),
  deviceInfo: uuid('0010'),
  control: uuid('0020'),
  rowing: uuid('0030'),
} as const;

export const CHAR = {
  /** Erg machine type in the device info service, 1 byte (as in demo/). */
  machineType: uuid('0016'),
  generalStatus: uuid('0031'),
  additionalStatus: uuid('0032'),
  additionalStatus2: uuid('0033'),
  sampleRate: uuid('0034'),
  strokeData: uuid('0035'),
  additionalStrokeData: uuid('0036'),
  /** Multiplexed data: [id, payload…]. Fallback when 0036 cannot be subscribed to. */
  multiplexed: uuid('0080'),
} as const;

/** Erg machine type value for the SkiErg (from demo/, which works against a real PM5). */
export const MACHINE_TYPE_SKIERG = 128;
export const MULTIPLEX_ID_ADDITIONAL_STROKE = 0x36;

/** Values for the sample rate characteristic (0034). */
export const SAMPLE_RATE = { s1: 0, ms500: 1, ms250: 2, ms100: 3 } as const;
