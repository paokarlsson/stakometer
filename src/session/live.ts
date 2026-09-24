// Live state for a running session (spec §4.3):
// DataSource → Resampler (1 Hz) → W′ balance + MPA → LiveSession → live view.
// Also drives the WorkoutRunner and the Recorder. No UI code; unit tested.
import type { Clock } from '../core/clock';
import type { Unsubscribe } from '../core/events';
import { mpa } from '../model/mpa';
import { Resampler, STALE_AFTER_S } from '../model/resample';
import type { FitnessSignature } from '../model/signature';
import { SKIBA, timeToEmpty, wbalStep, type SkibaConstants } from '../model/wbal';
import type { DataSource, Machine, StatusSample } from '../sources/DataSource';
import type { Session, SessionMode, SessionStore } from '../storage/types';
import type { TimelineSegment } from '../workout/schema';
import { WorkoutRunner } from '../workout/runner';
import { Recorder } from './recorder';

/** [FÖRSLAG] strokes in the displayed power average (spec §8.2, configurable). */
export const POWER_AVG_STROKES = 3;

export interface LivePoint {
  t: number; // session time, s
  value: number; // W
}

export interface LiveSessionOptions {
  mode: SessionMode;
  /** Machine recorded with the session; defaults to what the source reports, else SkiErg. */
  machine?: Machine;
  workoutId?: string;
  timeline: readonly TimelineSegment[] | null;
  signature: FitnessSignature | null;
  powerAvgStrokes?: number;
  skiba?: SkibaConstants;
}

export class LiveSession {
  readonly runner: WorkoutRunner;
  readonly recorder: Recorder;
  readonly signature: FitnessSignature | null;
  /** Power line: the N-stroke average at each stroke. */
  readonly power: LivePoint[] = [];
  /** MPA once per second. */
  readonly mpaSeries: LivePoint[] = [];
  /** W′ balance in J, null without a signature. */
  wbal: number | null;
  minWbal: { value: number; t: number } | null = null;
  lastStatus: StatusSample | null = null;

  private readonly resampler = new Resampler();
  private maxSum = 0;
  private maxCount = 0;
  private readonly recent: number[] = [];
  private lastStrokeT = -Infinity;
  private lastStrokeRate: number | null = null;
  private offs: Unsubscribe[] = [];
  private readonly avgN: number;
  private readonly skiba: SkibaConstants;

  constructor(
    private readonly source: DataSource,
    private readonly clock: Clock,
    store: SessionStore,
    private readonly opts: LiveSessionOptions,
  ) {
    this.runner = new WorkoutRunner(opts.timeline, clock);
    this.recorder = new Recorder(store, clock);
    this.signature = opts.signature;
    this.wbal = opts.signature?.wPrime ?? null;
    this.avgN = opts.powerAvgStrokes ?? POWER_AVG_STROKES;
    this.skiba = opts.skiba ?? SKIBA;
  }

  /** Starts the countdown and recording (t = 0 when the countdown ends). */
  async start(): Promise<Session> {
    this.runner.start();
    const zero = this.clock.now() - this.runner.sessionTime();
    const session = await this.recorder.start(this.source, {
      mode: this.opts.mode,
      machine: this.opts.machine ?? this.source.machine() ?? 'skierg',
      ...(this.opts.workoutId !== undefined && { workoutId: this.opts.workoutId }),
      timeline: this.opts.timeline,
      signature: this.opts.signature,
      startTs: zero,
    });
    this.offs = [
      this.source.onStroke((s) => {
        const t = s.ts - zero;
        this.resampler.push({ t, power: s.power });
        this.recent.push(s.power);
        if (this.recent.length > this.avgN) this.recent.shift();
        this.lastStrokeT = t;
        this.lastStrokeRate = s.strokeRate;
        this.power.push({ t, value: this.currentPowerAvg() });
      }),
      this.source.onStatus((s) => (this.lastStatus = s)),
      this.runner.stateChanged.on((state) => this.recorder.mark(state)),
    ];
    this.recorder.mark('countdown');
    return session;
  }

  /** Call every frame: advances the runner and the 1 Hz model. */
  tick(): void {
    this.runner.update();
    const t = this.runner.sessionTime();
    const sig = this.signature;
    const start = this.resampler.seconds;
    this.resampler.advanceTo(t).forEach((p, i) => {
      const n = start + i + 1;
      // Running average of the maximal effort, from the 1 Hz series like the test result (§7.2, §7.3).
      if (this.runner.segmentAt(this.runner.timelineAt(n - 0.5))?.isMax) {
        this.maxSum += p;
        this.maxCount += 1;
      }
      if (!sig || this.wbal === null) return;
      this.wbal = wbalStep(this.wbal, p, sig, 1, this.skiba);
      if (!this.minWbal || this.wbal < this.minWbal.value) this.minWbal = { value: this.wbal, t: n };
      this.mpaSeries.push({ t: n, value: mpa(this.wbal, sig) });
    });
  }

  async stop(): Promise<Session> {
    const status = this.runner.stop();
    for (const off of this.offs) off();
    this.offs = [];
    return this.recorder.stop(status);
  }

  sessionTime(): number {
    return this.runner.sessionTime();
  }

  /** Average of the last N strokes, 0 when standing still (cf. §5.4). */
  currentPowerAvg(): number {
    if (this.recent.length === 0 || this.sessionTime() - this.lastStrokeT > STALE_AFTER_S) return 0;
    return this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
  }

  strokeRate(): number | null {
    if (this.sessionTime() - this.lastStrokeT > STALE_AFTER_S) return null;
    return this.lastStatus?.strokeRate ?? this.lastStrokeRate;
  }

  heartRate(): number | null {
    return this.lastStatus?.heartRate ?? null;
  }

  /** wbal / W′ (may be negative), null without a signature. */
  wbalFraction(): number | null {
    return this.signature && this.wbal !== null ? this.wbal / this.signature.wPrime : null;
  }

  mpa(): number | null {
    return this.signature && this.wbal !== null ? mpa(this.wbal, this.signature) : null;
  }

  /** Average power so far in the maximal effort, or null before it has started. */
  maxEffortAverage(): number | null {
    return this.maxCount > 0 ? this.maxSum / this.maxCount : null;
  }

  /** Duration of the maximal effort in progress (running only), for the simulator's fatigue mode. */
  maxEffortDuration(): number | null {
    if (this.runner.state !== 'running') return null;
    const seg = this.runner.current()?.segment;
    return seg?.isMax ? seg.end - seg.start : null;
  }

  /** Seconds to empty W′ at the current power, when above CP. */
  timeToEmpty(): number | null {
    return this.signature && this.wbal !== null ? timeToEmpty(this.wbal, this.currentPowerAvg(), this.signature.cp) : null;
  }
}
