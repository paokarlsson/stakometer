// PM5 Bluetooth UUIDs (spec §9.2). [VERIFY] Not yet confirmed against a real PM5.

const uuid = (short: string): string => `ce06${short.toLowerCase()}-43e5-11e4-916c-0800200c9a66`;

export const SERVICE = {
  deviceInfo: uuid('0010'),
  control: uuid('0020'),
  rowing: uuid('0030'),
} as const;

export const CHAR = {
  generalStatus: uuid('0031'),
  additionalStatus: uuid('0032'),
  additionalStatus2: uuid('0033'),
  sampleRate: uuid('0034'),
  strokeData: uuid('0035'),
  additionalStrokeData: uuid('0036'),
} as const;

/** Values for the sample rate characteristic (0034). */
export const SAMPLE_RATE = { s1: 0, ms500: 1, ms250: 2, ms100: 3 } as const;
