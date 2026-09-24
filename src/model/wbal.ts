// W′ balance (spec §5.5), Skiba 2012 with configurable constants.
import type { SignatureParams } from './signature';

export interface SkibaConstants {
  a: number;
  b: number;
  c: number;
}

/** τ = a · e^(−b · D) + c. From cycling; configurable (spec §5.5, §13). */
export const SKIBA: SkibaConstants = { a: 546, b: 0.01, c: 316 };

/** Recovery time constant for a power deficit D = CP − p (W). */
export function tau(deficit: number, k: SkibaConstants = SKIBA): number {
  return k.a * Math.exp(-k.b * deficit) + k.c;
}

/** One step of Δt seconds at power p. wbal may go negative. */
export function wbalStep(wbal: number, p: number, s: Pick<SignatureParams, 'cp' | 'wPrime'>, dt = 1, k: SkibaConstants = SKIBA): number {
  if (p > s.cp) return wbal - (p - s.cp) * dt;
  return s.wPrime - (s.wPrime - wbal) * Math.exp(-dt / tau(s.cp - p, k));
}

/** W′ balance after each 1 Hz sample, starting from full W′. */
export function wbalSeries(powers: readonly number[], s: Pick<SignatureParams, 'cp' | 'wPrime'>, k: SkibaConstants = SKIBA): number[] {
  let w = s.wPrime;
  return powers.map((p) => (w = wbalStep(w, p, s, 1, k)));
}

/** Seconds until W′ is empty at power p > CP; null at or below CP. */
export function timeToEmpty(wbal: number, p: number, cp: number): number | null {
  return p > cp ? Math.max(wbal, 0) / (p - cp) : null;
}

export type WbalZone = 'green' | 'yellow' | 'orange' | 'red';

/** Lower bounds of wbal / W′ for each zone (spec §5.7), configurable. */
export const WBAL_ZONES = { green: 0.6, yellow: 0.4, orange: 0.3 };

export function wbalZone(fraction: number, z = WBAL_ZONES): WbalZone {
  if (fraction >= z.green) return 'green';
  if (fraction >= z.yellow) return 'yellow';
  if (fraction >= z.orange) return 'orange';
  return 'red';
}
