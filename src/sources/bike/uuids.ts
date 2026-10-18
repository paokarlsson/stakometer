// Bluetooth SIG UUIDs for bike trainers. Only notifications are used: the app never writes
// to the trainer (no FTMS Control Point 0x2AD9), so Zwift can control it at the same time.

const sig = (short: number): string => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const SERVICE = {
  ftms: sig(0x1826),
  cyclingPower: sig(0x1818),
} as const;

export const CHAR = {
  indoorBikeData: sig(0x2ad2),
  cyclingPowerMeasurement: sig(0x2a63),
} as const;
