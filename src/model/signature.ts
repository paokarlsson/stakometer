import type { Machine } from '../sources/DataSource';

/** Fitness Signature (spec §5.1). Model functions arrive in step 2. */
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
