// Post-session analysis from raw chunks (spec §8.3, §7.3). Nothing here is stored;
// everything is recomputed from the recorded strokes and runner events (§11).
import { resample } from '../model/resample';
import type { SignatureParams } from '../model/signature';
import { DEFAULT_WBAL, wbalSeries, type WbalOptions } from '../model/wbal';
import type { Chunk, RunnerEvent, Session } from '../storage/types';
import { targetAt } from '../workout/ramp';
import type { TimelineSegment } from '../workout/schema';

/**
 * Session time → timeline time from recorded runner events: the timeline runs
 * between 'running' and the next 'paused'/'finished'. Null outside those spans.
 */
export function timelineMapper(events: readonly RunnerEvent[]): (t: number) => number | null {
  const spans: { start: number; end: number; timelineStart: number }[] = [];
  let open: number | null = null;
  let timeline = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.state === 'running' && open === null) open = e.t;
    else if ((e.state === 'paused' || e.state === 'finished') && open !== null) {
      spans.push({ start: open, end: e.t, timelineStart: timeline });
      timeline += e.t - open;
      open = null;
    }
  }
  if (open !== null) spans.push({ start: open, end: Infinity, timelineStart: timeline });
  return (t) => {
    const s = spans.find((sp) => t >= sp.start && t < sp.end);
    return s ? s.timelineStart + (t - s.start) : null;
  };
}

export interface SegmentStats {
  segment: TimelineSegment;
  seconds: number; // 1 Hz samples inside the segment
  avgPower: number | null;
  /** Share of the segment's seconds with power inside the band; null without a band. */
  inBand: number | null;
  /** Lowest W′ balance in the segment as a fraction of W′ (may be negative); null without a signature. */
  minWbal: number | null;
}

/** Averages over the strokes and statuses, for the summary after the session (spec §8.3). */
export interface StrokeStats {
  /** Average of the valid heart rates, bpm; null when the source gave none. */
  avgHeartRate: number | null;
  /** Average stroke rate over the strokes, strokes/min. */
  avgStrokeRate: number | null;
  /** Median drag factor over the strokes; null when the source gives none. */
  dragFactor: number | null;
}

export interface SessionAnalysis {
  /** 1 Hz power; sample i covers session time (i, i + 1]. */
  power: number[];
  /** W′ balance after each sample, J; null without a signature. */
  wbal: number[] | null;
  /** Timeline time at the middle of each sample; null during pauses or without a timeline. */
  timeline: (number | null)[];
  segments: SegmentStats[];
  /**
   * The maximal effort, if the session had one. `complete` when all of it was recorded.
   * `dragFactor` is the median over its strokes, null when the source gives none.
   */
  maxEffort: { segment: TimelineSegment; avgPower: number; complete: boolean; dragFactor: number | null } | null;
}

/** Median, or null for an empty list. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

const mean = (values: readonly number[]): number | null => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function strokeStats(chunks: readonly Chunk[]): StrokeStats {
  const strokes = chunks.flatMap((c) => c.strokes);
  const status = chunks.flatMap((c) => c.status);
  return {
    avgHeartRate: mean(status.flatMap((s) => (s.heartRate !== undefined && s.heartRate > 0 ? [s.heartRate] : []))),
    avgStrokeRate: mean(strokes.flatMap((s) => (s.strokeRate > 0 ? [s.strokeRate] : []))),
    dragFactor: median(strokes.flatMap((s) => (s.raw?.dragFactor !== undefined ? [s.raw.dragFactor] : []))),
  };
}

export function analyzeSession(session: Session, chunks: readonly Chunk[], wbalOptions: WbalOptions = DEFAULT_WBAL): SessionAnalysis {
  const strokes = chunks.flatMap((c) => c.strokes);
  const status = chunks.flatMap((c) => c.status);
  let duration = 0;
  for (const s of [...strokes, ...status]) duration = Math.max(duration, s.t);
  const power = resample(strokes, Math.floor(duration));
  const sig: SignatureParams | null = session.signatureSnapshot;
  const wbal = sig ? wbalSeries(power, sig, wbalOptions) : null;

  const toTimeline = timelineMapper(chunks.flatMap((c) => c.runner ?? []));
  const timeline = power.map((_, i) => (session.timeline ? toTimeline(i + 0.5) : null));

  const segments: SegmentStats[] = (session.timeline ?? []).map((segment) => {
    const inside: { p: number; tl: number }[] = [];
    let minWbal: number | null = null;
    power.forEach((p, i) => {
      const tl = timeline[i];
      if (tl === null || tl === undefined || tl < segment.start || tl >= segment.end) return;
      inside.push({ p, tl });
      const w = wbal?.[i];
      if (sig && w !== undefined) minWbal = Math.min(minWbal ?? Infinity, w / sig.wPrime);
    });
    const avgPower = inside.length > 0 ? inside.reduce((a, x) => a + x.p, 0) / inside.length : null;
    // The band at each second, ramps included.
    const withBand = inside.map((x) => ({ p: x.p, band: targetAt(session.timeline!, x.tl) })).filter((x) => x.band !== null);
    const inBand = withBand.length > 0 ? withBand.filter((x) => x.p >= x.band!.lo && x.p <= x.band!.hi).length / withBand.length : null;
    return { segment, seconds: inside.length, avgPower, inBand, minWbal };
  });

  const max = segments.find((s) => s.segment.isMax);
  const maxDragFactors = (seg: TimelineSegment): number[] =>
    strokes.flatMap((s) => {
      const tl = session.timeline ? toTimeline(s.t) : null;
      const df = s.raw?.dragFactor;
      return tl !== null && tl >= seg.start && tl < seg.end && df !== undefined ? [df] : [];
    });
  const maxEffort =
    max && max.avgPower !== null
      ? {
          segment: max.segment,
          avgPower: max.avgPower,
          complete: max.seconds >= max.segment.end - max.segment.start - 1,
          dragFactor: median(maxDragFactors(max.segment)),
        }
      : null;

  return { power, wbal, timeline, segments, maxEffort };
}

/** The rows of the table per interval (§8.3): the intervals and the maximal effort when there are any, else every segment with a target. */
export function intervalRows(segments: readonly SegmentStats[]): SegmentStats[] {
  const work = segments.filter((x) => x.segment.kind === 'interval' || x.segment.isMax);
  return work.length > 0 ? work : segments.filter((x) => x.segment.targetW !== null);
}
