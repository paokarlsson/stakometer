// User settings (spec §8.5), stored key–value in the `settings` store.
import { DEFAULT_WBAL, SKIBA, WBAL_MODELS, WBAL_ZONES, type SkibaConstants, type WbalModel, type WbalOptions } from '../model/wbal';
import { POWER_AVG_STROKES } from '../session/live';
import type { Machine } from '../sources/DataSource';
import type { CalibrationMode } from '../workout/calibrate';
import { DEFAULT_TOLERANCE } from '../workout/expand';

export interface Settings {
  /** Default band half-width, e.g. 0.05 = ±5 %. */
  tolerance: number;
  /** Strokes in the displayed power average. */
  powerAvgStrokes: number;
  /** Lower bounds of wbal / W′ for green, yellow and orange (spec §5.7). */
  zones: { green: number; yellow: number; orange: number };
  /** W′ recovery model (spec §5.5). */
  wbalModel: WbalModel;
  /** Constants for the Skiba 2012 model. */
  skiba: SkibaConstants;
  /** 'auto' uses what the PM reports (Bluetooth), falling back to SkiErg. */
  machine: 'auto' | Machine;
  /** How workouts are fitted to the planned W′ balance (off, only lower, or land on the minimum). */
  calibration: CalibrationMode;
  /** Planned lowest W′ as a fraction of W′ that workouts must not go below. */
  minWbal: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tolerance: DEFAULT_TOLERANCE,
  powerAvgStrokes: POWER_AVG_STROKES,
  zones: { ...WBAL_ZONES },
  wbalModel: DEFAULT_WBAL.model,
  skiba: { ...SKIBA },
  machine: 'auto',
  calibration: 'fit',
  minWbal: 0.3,
};

const MACHINES = ['auto', 'skierg', 'rowerg', 'bikeerg'] as const;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns an error message (UI text) or null. */
export function validateSettings(s: Settings): string | null {
  if (!isNum(s.tolerance) || s.tolerance <= 0 || s.tolerance > 0.5) return 'Toleransen måste vara mellan 0 och 50 %.';
  if (!Number.isInteger(s.powerAvgStrokes) || s.powerAvgStrokes < 1 || s.powerAvgStrokes > 10) return 'Antal drag i medlet måste vara 1–10.';
  const { green, yellow, orange } = s.zones;
  if (![green, yellow, orange].every(isNum) || !(1 > green && green > yellow && yellow > orange && orange > 0)) {
    return 'Zongränserna måste vara grön > gul > orange, mellan 0 och 100 %.';
  }
  if (!WBAL_MODELS.includes(s.wbalModel)) return 'Okänd W′-modell.';
  if (![s.skiba.a, s.skiba.b, s.skiba.c].every((v) => isNum(v) && v > 0)) return 'Skiba-konstanterna måste vara positiva tal.';
  if (!MACHINES.includes(s.machine)) return 'Okänd maskintyp.';
  if (!['off', 'lower', 'fit'].includes(s.calibration)) return 'Okänt läge för anpassning av passen.';
  if (!isNum(s.minWbal) || s.minWbal < 0 || s.minWbal > 0.9) return 'Lägsta W′ måste vara mellan 0 och 90 %.';
  return null;
}

/** Stored key–value records → Settings. Unknown or invalid values fall back to defaults. */
export function settingsFromRecords(records: readonly { key: string; value: unknown }[]): Settings {
  const stored = Object.fromEntries(records.map((r) => [r.key, r.value])) as Partial<Settings>;
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    zones: { ...DEFAULT_SETTINGS.zones, ...(stored.zones ?? {}) },
    skiba: { ...DEFAULT_SETTINGS.skiba, ...(stored.skiba ?? {}) },
  };
  return validateSettings(merged) === null ? merged : DEFAULT_SETTINGS;
}

export function settingsToRecords(s: Settings): { key: string; value: unknown }[] {
  return Object.entries(s).map(([key, value]) => ({ key, value }));
}

export function wbalOptions(s: Settings): WbalOptions {
  return { model: s.wbalModel, skiba: s.skiba };
}

/** The workout's timeline fitted to the settings' lowest W′ (tests are never fitted). */
export function calibrationOptions(s: Settings): { mode: CalibrationMode; minFraction: number; wbal: WbalOptions } {
  return { mode: s.calibration, minFraction: s.minWbal, wbal: wbalOptions(s) };
}
