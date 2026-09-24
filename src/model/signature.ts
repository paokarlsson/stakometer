import type { Machine } from '../sources/DataSource';

/** Fitness Signature (spec §5.1). */
export interface FitnessSignature {
  id: string;
  machine: Machine;
  pp: number; // W
  cp: number; // W
  wPrime: number; // J
  createdAt: string; // ISO 8601
  source: 'manual' | 'test3p';
  testResultIds?: string[];
}

export type SignatureParams = Pick<FitnessSignature, 'pp' | 'cp' | 'wPrime'>;

/** Derived time constant k = W′ / (PP − CP), in seconds. */
export function kOf(s: SignatureParams): number {
  return s.wPrime / (s.pp - s.cp);
}

/** Returns an error message (UI text) or null when pp > cp > 0 and wPrime > 0. */
export function validateSignature(s: SignatureParams): string | null {
  if (![s.pp, s.cp, s.wPrime].every(Number.isFinite)) return 'Alla värden måste vara tal.';
  if (s.cp <= 0) return 'CP måste vara större än 0.';
  if (s.pp <= s.cp) return 'PP måste vara större än CP.';
  if (s.wPrime <= 0) return 'W′ måste vara större än 0.';
  return null;
}

/** Placeholder signature for the simulator (spec §5.1), not real values. k = 50 s. */
export const SIMULATOR_SIGNATURE: SignatureParams = { pp: 500, cp: 200, wPrime: 15_000 };

export function simulatorSignature(machine: Machine = 'skierg'): FitnessSignature {
  return { id: 'simulator-default', machine, ...SIMULATOR_SIGNATURE, createdAt: new Date(0).toISOString(), source: 'manual' };
}
