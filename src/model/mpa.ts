// Maximal power available now (spec §5.6): MPA = CP + max(wbal, 0) / k.
// Full W′ gives PP, empty W′ gives CP.
import { kOf, type SignatureParams } from './signature';

export function mpa(wbal: number, s: SignatureParams): number {
  return s.cp + Math.max(wbal, 0) / kOf(s);
}
