import { resample } from '../model/resample';
import type { SignatureParams } from '../model/signature';
import { wbalSeries } from '../model/wbal';
import type { Chunk, SessionSummary } from '../storage/types';

/** Summary values computed from raw chunk data (spec §11: no derived series are stored). */
export function summarize(chunks: readonly Chunk[], signature: SignatureParams | null = null): SessionSummary {
  const strokes = chunks.flatMap((c) => c.strokes);
  const status = chunks.flatMap((c) => c.status);

  let duration = 0;
  for (const s of strokes) duration = Math.max(duration, s.t);
  for (const s of status) duration = Math.max(duration, s.t);

  // PM5 distance is cumulative for its own workout, so take the difference over the session.
  const dist = status.length > 0 ? status.map((s) => s.distance) : strokes.map((s) => s.distance);
  const distance = dist.length > 0 ? Math.max(0, dist[dist.length - 1]! - dist[0]!) : 0;

  const powers = resample(strokes, Math.floor(duration));
  const work = powers.reduce((sum, p) => sum + p, 0);
  const avgPower = strokes.length > 0 && powers.length > 0 ? work / powers.length : null;

  let minWbal: SessionSummary['minWbal'] = null;
  if (signature && powers.length > 0) {
    wbalSeries(powers, signature).forEach((w, i) => {
      const fraction = w / signature.wPrime;
      if (!minWbal || fraction < minWbal.fraction) minWbal = { fraction, t: i + 1 };
    });
  }

  return { duration, distance, strokeCount: strokes.length, avgPower, workKJ: work / 1000, minWbal };
}
