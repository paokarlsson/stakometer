// W′ balance (spec §5.5). Above CP W′ drains by (P − CP) · Δt in every model.
// Below CP it recovers towards W′ with a time constant τ that depends on the model:
//   skiba2015 (default): τ = W′ / D                     (Skiba et al. 2015, differential)
//   skiba2012:           τ = a · e^(−b · D) + c           (Skiba et al. 2012, cycling constants)
//   bartram2018:         τ = 2287.2 · D^(−0.688)          (Bartram et al. 2018)
// where D = CP − P. Recovery per step: wbal = W′ − (W′ − wbal) · e^(−Δt / τ).
import type { SignatureParams } from './signature';

export interface SkibaConstants {
  a: number;
  b: number;
  c: number;
}

/** Skiba 2012 constants, from cycling; configurable (spec §5.5, §13). */
export const SKIBA: SkibaConstants = { a: 546, b: 0.01, c: 316 };

export const WBAL_MODELS = ['skiba2015', 'skiba2012', 'bartram2018'] as const;
export type WbalModel = (typeof WBAL_MODELS)[number];

export interface WbalOptions {
  model: WbalModel;
  /** Used by skiba2012 only. */
  skiba: SkibaConstants;
}

/** Skiba 2015 by the user's decision 2026-09-24: 2012 recovered far too slowly. */
export const DEFAULT_WBAL: WbalOptions = { model: 'skiba2015', skiba: SKIBA };

/** Skiba 2012 recovery time constant for a power deficit D = CP − p (W). */
export function tau(deficit: number, k: SkibaConstants = SKIBA): number {
  return k.a * Math.exp(-k.b * deficit) + k.c;
}

/** Recovery time constant in seconds for a deficit D = CP − p ≥ 0. Infinity at D = 0 for the D-based models. */
export function recoveryTau(deficit: number, wPrime: number, o: WbalOptions = DEFAULT_WBAL): number {
  switch (o.model) {
    case 'skiba2012':
      return tau(deficit, o.skiba);
    case 'bartram2018':
      return deficit > 0 ? 2287.2 * Math.pow(deficit, -0.688) : Infinity;
    case 'skiba2015':
      return deficit > 0 ? wPrime / deficit : Infinity;
  }
}

/** One step of Δt seconds at power p. wbal may go negative. */
export function wbalStep(wbal: number, p: number, s: Pick<SignatureParams, 'cp' | 'wPrime'>, dt = 1, o: WbalOptions = DEFAULT_WBAL): number {
  if (p > s.cp) return wbal - (p - s.cp) * dt;
  return s.wPrime - (s.wPrime - wbal) * Math.exp(-dt / recoveryTau(s.cp - p, s.wPrime, o));
}

/** W′ balance after each 1 Hz sample, starting from full W′. */
export function wbalSeries(powers: readonly number[], s: Pick<SignatureParams, 'cp' | 'wPrime'>, o: WbalOptions = DEFAULT_WBAL): number[] {
  let w = s.wPrime;
  return powers.map((p) => (w = wbalStep(w, p, s, 1, o)));
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
