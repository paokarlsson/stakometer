import type { Chunk, SessionSummary } from '../storage/types';

/**
 * Summary values computed from raw chunk data (spec §11: no derived series are stored).
 * avgPower is the mean stroke power for now; step 2 switches it to the 1 Hz series (§5.4).
 */
export function summarize(chunks: readonly Chunk[]): SessionSummary {
  const strokes = chunks.flatMap((c) => c.strokes);
  const status = chunks.flatMap((c) => c.status);

  let duration = 0;
  for (const s of strokes) duration = Math.max(duration, s.t);
  for (const s of status) duration = Math.max(duration, s.t);

  // PM5 distance is cumulative for its own workout, so take the difference over the session.
  const dist = status.length > 0 ? status.map((s) => s.distance) : strokes.map((s) => s.distance);
  const distance = dist.length > 0 ? Math.max(0, dist[dist.length - 1]! - dist[0]!) : 0;

  const avgPower = strokes.length > 0 ? strokes.reduce((sum, s) => sum + s.power, 0) / strokes.length : null;

  return { duration, distance, strokeCount: strokes.length, avgPower };
}
