// Morton's 3-parameter power-duration model (spec §5.2):
// P(t) = CP + W′ / (t + k)  with  k = W′ / (PP − CP), so P(0) = PP.
import { kOf, type SignatureParams } from './signature';

/** Power sustainable for t seconds. */
export function powerAt(t: number, s: SignatureParams): number {
  return s.cp + s.wPrime / (t + kOf(s));
}

/**
 * Time to exhaustion at constant power p: W′ / (p − CP) − k.
 * Infinity for p ≤ CP; null when the model says p is impossible (result ≤ 0, i.e. p ≥ PP).
 */
export function timeToExhaustion(p: number, s: SignatureParams): number | null {
  if (p <= s.cp) return Infinity;
  const t = s.wPrime / (p - s.cp) - kOf(s);
  return t > 0 ? t : null;
}
