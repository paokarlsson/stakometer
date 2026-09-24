// Stroke power to a 1 Hz series (spec §5.4).
// Sample n (n = 1, 2, …) covers the second (n − 1, n] and holds the power of the
// latest stroke completed at or before t = n. It is 0 before the first stroke and
// when no stroke has come for more than STALE_AFTER_S.

/** [FÖRSLAG] constant. */
export const STALE_AFTER_S = 4;

export interface PowerPoint {
  t: number; // s from session start
  power: number; // W
}

/** Incremental resampler for live use. Strokes must be pushed in time order. */
export class Resampler {
  private lastStroke: PowerPoint | null = null;
  private pending: PowerPoint[] = [];
  private next = 1; // next sample index to emit

  constructor(private readonly staleAfter = STALE_AFTER_S) {}

  push(stroke: PowerPoint): void {
    this.pending.push(stroke);
  }

  /** Emits every whole second up to and including floor(t). */
  advanceTo(t: number): number[] {
    const out: number[] = [];
    while (this.next <= t) {
      const n = this.next++;
      while (this.pending.length > 0 && this.pending[0]!.t <= n) this.lastStroke = this.pending.shift()!;
      const s = this.lastStroke;
      out.push(s && n - s.t <= this.staleAfter ? s.power : 0);
    }
    return out;
  }

  /** Number of samples emitted so far = the time in whole seconds covered. */
  get seconds(): number {
    return this.next - 1;
  }
}

/** Batch version: the 1 Hz series for `duration` seconds. */
export function resample(strokes: readonly PowerPoint[], duration: number, staleAfter = STALE_AFTER_S): number[] {
  const r = new Resampler(staleAfter);
  for (const s of [...strokes].sort((a, b) => a.t - b.t)) r.push(s);
  return r.advanceTo(duration);
}
