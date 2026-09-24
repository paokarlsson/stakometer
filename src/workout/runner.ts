// Runs a timeline against the app clock (spec §6.3):
// idle → countdown (5 s) → running ⇄ paused → finished.
// Session time t = 0 when the countdown ends. The timeline follows the clock while
// running and is frozen while paused; session time (and W′) keep going.
import type { Clock } from '../core/clock';
import { Emitter } from '../core/events';
import { segmentIndexAt, totalDuration } from './expand';
import type { TimelineSegment } from './schema';

export type RunnerState = 'idle' | 'countdown' | 'running' | 'paused' | 'finished';

export const COUNTDOWN_S = 5;

/** A stretch of running: session time [sessionStart, sessionEnd) maps to timeline time from timelineStart. */
interface Span {
  sessionStart: number;
  timelineStart: number;
  sessionEnd: number | null;
}

export interface CurrentSegment {
  index: number;
  segment: TimelineSegment;
  remaining: number; // s of timeline left in the segment
  next: TimelineSegment | null;
}

export class WorkoutRunner {
  readonly stateChanged = new Emitter<RunnerState>();
  private current_: RunnerState = 'idle';
  private zero = 0; // clock time of session t = 0
  private spans: Span[] = [];
  private completed = false;

  /** `timeline` null means free ride: no targets, runs until stopped. */
  constructor(
    readonly timeline: readonly TimelineSegment[] | null,
    private readonly clock: Clock,
    private readonly countdownS = COUNTDOWN_S,
  ) {}

  get state(): RunnerState {
    return this.current_;
  }

  /** Total timeline length, or null for free ride. */
  get duration(): number | null {
    return this.timeline ? totalDuration(this.timeline) : null;
  }

  /** True when finished because the timeline ran out (not stopped early). */
  get isComplete(): boolean {
    return this.completed;
  }

  start(): void {
    if (this.current_ !== 'idle') return;
    this.zero = this.clock.now() + this.countdownS;
    this.set('countdown');
  }

  /** Advances state from the clock. Call regularly, e.g. every frame. */
  update(): void {
    if (this.current_ === 'countdown' && this.sessionTime() >= 0) {
      this.spans.push({ sessionStart: 0, timelineStart: 0, sessionEnd: null });
      this.set('running');
    }
    const duration = this.duration;
    if (this.current_ === 'running' && duration !== null && this.timelineTime() >= duration) {
      this.completed = true;
      this.closeSpan(this.sessionTimeAtTimeline(duration));
      this.set('finished');
    }
  }

  pause(): void {
    this.update();
    if (this.current_ !== 'running') return;
    this.closeSpan(this.sessionTime());
    this.set('paused');
  }

  resume(): void {
    if (this.current_ !== 'paused') return;
    this.spans.push({ sessionStart: this.sessionTime(), timelineStart: this.timelineTime(), sessionEnd: null });
    this.set('running');
  }

  /** Ends the session. Free ride and a completed timeline count as completed, anything else as aborted. */
  stop(): 'completed' | 'aborted' {
    this.update();
    if (this.current_ !== 'finished') {
      if (this.current_ === 'running') this.closeSpan(this.sessionTime());
      this.set('finished');
    }
    return this.completed || this.timeline === null ? 'completed' : 'aborted';
  }

  /** Seconds since t = 0; negative during the countdown. */
  sessionTime(): number {
    return this.clock.now() - this.zero;
  }

  /** Timeline position now. Negative during the countdown, frozen while paused. */
  timelineTime(): number {
    const span = this.spans.at(-1);
    if (!span) return this.current_ === 'countdown' ? this.sessionTime() : 0;
    const end = span.sessionEnd ?? this.sessionTime();
    return span.timelineStart + (end - span.sessionStart);
  }

  /**
   * Timeline time shown at session time t, for drawing. Past: where the timeline was
   * (null during pauses). Future: assumes running from now on.
   */
  timelineAt(t: number): number | null {
    const now = this.sessionTime();
    if (t >= now) return this.current_ === 'finished' ? null : this.timelineTime() + (t - now);
    if (t < 0) return t;
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const s = this.spans[i]!;
      if (t >= s.sessionStart) return s.sessionEnd === null || t < s.sessionEnd ? s.timelineStart + (t - s.sessionStart) : null;
    }
    return null;
  }

  /** Segment at timeline time t, or null. */
  segmentAt(t: number | null): TimelineSegment | null {
    if (t === null || !this.timeline) return null;
    return this.timeline[segmentIndexAt(this.timeline, t)] ?? null;
  }

  current(): CurrentSegment | null {
    if (!this.timeline) return null;
    const t = Math.max(0, this.timelineTime());
    const index = segmentIndexAt(this.timeline, t);
    const segment = this.timeline[index];
    if (!segment) return null;
    return { index, segment, remaining: segment.end - t, next: this.timeline[index + 1] ?? null };
  }

  /** Target in W while running, for the simulator's followTarget mode. */
  target(): number | null {
    return this.current_ === 'running' ? (this.current()?.segment.targetW ?? null) : null;
  }

  private sessionTimeAtTimeline(t: number): number {
    const span = this.spans.at(-1)!;
    return span.sessionStart + (t - span.timelineStart);
  }

  private closeSpan(sessionEnd: number): void {
    const span = this.spans.at(-1);
    if (span && span.sessionEnd === null) span.sessionEnd = sessionEnd;
  }

  private set(state: RunnerState): void {
    this.current_ = state;
    this.stateChanged.emit(state);
  }
}

const BEEP_AT = [3, 2, 1];

/**
 * Number of segment-change beeps due when the time left in a segment goes from
 * `before` to `after` (spec §6.3: three short beeps in the last three seconds).
 */
export function beepsDue(before: number, after: number): number {
  return BEEP_AT.filter((b) => before > b && after <= b).length;
}
