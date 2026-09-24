// Post-session analysis from raw chunks (spec §8.3, §7.3). Nothing here is stored;
// everything is recomputed from the recorded strokes and runner events (§11).
import { resample } from '../model/resample';
import type { SignatureParams } from '../model/signature';
import { SKIBA, wbalSeries, type SkibaConstants } from '../model/wbal';
import type { Chunk, RunnerEvent, Session } from '../storage/types';
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
}

export interface SessionAnalysis {
  /** 1 Hz power; sample i covers session time (i, i + 1]. */
  power: number[];
  /** W′ balance after each sample, J; null without a signature. */
  wbal: number[] | null;
  /** Timeline time at the middle of each sample; null during pauses or without a timeline. */
  timeline: (number | null)[];
  segments: SegmentStats[];
  /** The maximal effort, if the session had one. `complete` when all of it was recorded. */
  maxEffort: { segment: TimelineSegment; avgPower: number; complete: boolean } | null;
}

export function analyzeSession(session: Session, chunks: readonly Chunk[], skiba: SkibaConstants = SKIBA): SessionAnalysis {
  const strokes = chunks.flatMap((c) => c.strokes);
  const status = chunks.flatMap((c) => c.status);
  let duration = 0;
  for (const s of [...strokes, ...status]) duration = Math.max(duration, s.t);
  const power = resample(strokes, Math.floor(duration));
  const sig: SignatureParams | null = session.signatureSnapshot;
  const wbal = sig ? wbalSeries(power, sig, skiba) : null;

  const toTimeline = timelineMapper(chunks.flatMap((c) => c.runner ?? []));
  const timeline = power.map((_, i) => (session.timeline ? toTimeline(i + 0.5) : null));

  const segments: SegmentStats[] = (session.timeline ?? []).map((segment) => {
    const inside = power.filter((_, i) => {
      const tl = timeline[i];
      return tl !== null && tl !== undefined && tl >= segment.start && tl < segment.end;
    });
    const avgPower = inside.length > 0 ? inside.reduce((a, b) => a + b, 0) / inside.length : null;
    const { lo, hi } = segment;
    const inBand = lo !== null && hi !== null && inside.length > 0 ? inside.filter((p) => p >= lo && p <= hi).length / inside.length : null;
    return { segment, seconds: inside.length, avgPower, inBand };
  });

  const max = segments.find((s) => s.segment.isMax);
  const maxEffort =
    max && max.avgPower !== null
      ? { segment: max.segment, avgPower: max.avgPower, complete: max.seconds >= max.segment.end - max.segment.start - 1 }
      : null;

  return { power, wbal, timeline, segments, maxEffort };
}
