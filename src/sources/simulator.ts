// Simulated PM5 (spec §10).
import type { Clock } from '../core/clock';
import { mpa } from '../model/mpa';
import { powerAt } from '../model/morton3p';
import type { SignatureParams } from '../model/signature';
import { wbalStep } from '../model/wbal';
import { BaseSource, type Machine } from './DataSource';

export type SimMode = 'followTarget' | 'manual' | 'fatigue';

/** The fatigue mode's "true" signature (spec §10). */
export const TRUE_SIGNATURE: SignatureParams = { pp: 550, cp: 220, wPrime: 18_000 };

export interface SimulatorOptions {
  mode?: SimMode;
  /** Current target in W for `followTarget` and `fatigue`; null means no target. */
  target?: () => number | null;
  /** Duration of the maximal effort in progress, or null (for `fatigue`). */
  maxEffort?: () => number | null;
  /** The fatigue mode's own signature. */
  trueSignature?: SignatureParams;
  /** Base power for `followTarget` when there is no target. */
  freePower?: number;
  /** Starting power for `manual`. */
  manualPower?: number;
  /** Uniform [0, 1) random source, injectable for tests. */
  random?: () => number;
  /** Real-time tick interval of the driving timer. */
  tickMs?: number;
}

export const STATUS_INTERVAL_S = 0.1;
export const POWER_NOISE_SD = 0.07;
export const DEVIATION_PROBABILITY = 0.05;
export const DEVIATION = 0.2;
export const MANUAL_STEP_W = 10;
const STROKE_RATE_NOISE_SD = 1;
const IDLE_AFTER_S = 4; // no stroke for this long means standing still (cf. §5.4)
const IDLE_POLL_S = 0.25;
/** A step up in wanted power of more than this starts a faster stroke right away. */
const STEP_UP = 1.2;
/** Shortest time from a step up to the end of the first harder stroke (one drive). */
const MIN_DRIVE_S = 0.6;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Stroke rate in strokes/min for a given power, before noise (spec §10). */
export const baseStrokeRate = (power: number): number => clamp(28 + 0.06 * power, 25, 60);

/** Concept2 relation between power and speed: P = 2.80 · v³. */
export const speedFromPower = (power: number): number => (power > 0 ? Math.cbrt(power / 2.8) : 0);

/** Deterministic PRNG (mulberry32) for reproducible simulations. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box–Muller. */
export function gaussian(random: () => number): number {
  const u = 1 - random(); // (0, 1]
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Simulator extends BaseSource {
  readonly kind = 'simulator' as const;
  mode: SimMode;

  private readonly target: () => number | null;
  private readonly maxEffort: () => number | null;
  readonly trueSignature: SignatureParams;
  /** The fatigue mode's own W′ balance, J. */
  trueWbal: number;
  private readonly freePower: number;
  private readonly random: () => number;
  private readonly tickMs: number;
  private manualPower: number;
  private pulling = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  private startTs = 0;
  private nextStatusAt = 0;
  private nextStrokeAt = 0;
  private lastStrokeAt = -Infinity;
  private lastPower = 0;
  private lastRate = 0;
  private strokeCount = 0;
  private distance = 0;

  constructor(
    private readonly clock: Clock,
    opts: SimulatorOptions = {},
  ) {
    super();
    this.mode = opts.mode ?? 'followTarget';
    this.target = opts.target ?? (() => null);
    this.maxEffort = opts.maxEffort ?? (() => null);
    this.trueSignature = opts.trueSignature ?? TRUE_SIGNATURE;
    this.trueWbal = this.trueSignature.wPrime;
    this.freePower = opts.freePower ?? 180;
    this.manualPower = opts.manualPower ?? 150;
    this.random = opts.random ?? Math.random;
    this.tickMs = opts.tickMs ?? 20;
  }

  async connect(): Promise<void> {
    this.startTs = this.clock.now();
    this.nextStatusAt = this.startTs;
    this.nextStrokeAt = this.startTs + 1;
    this.lastStrokeAt = -Infinity;
    this.strokeCount = 0;
    this.distance = 0;
    this.trueWbal = this.trueSignature.wPrime;
    this.setConnection('connected');
    if (this.tickMs > 0) this.timer = setInterval(() => this.advance(this.clock.now()), this.tickMs);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setConnection('disconnected');
  }

  machine(): Machine {
    return 'skierg';
  }

  /** The power the simulated athlete aims for, before noise and (in fatigue mode) the MPA cap. */
  get power(): number {
    if (this.mode === 'manual') return this.manualPower;
    if (this.mode === 'fatigue') {
      // Maximal effort: even pacing at the true model's P(t) for the effort's duration.
      const max = this.maxEffort();
      if (max !== null) return powerAt(max, this.trueSignature);
    }
    return this.target() ?? this.freePower;
  }

  /** Fatigue mode: the most the simulated athlete can give right now. */
  get trueMpa(): number {
    return mpa(this.trueWbal, this.trueSignature);
  }

  get isPulling(): boolean {
    return this.pulling;
  }

  /** Manual mode: arrow keys change power by ±10 W. */
  adjustPower(delta: number): void {
    this.manualPower = Math.max(0, this.manualPower + delta);
  }

  /** Manual mode: space stops and resumes pulling. */
  setPulling(pulling: boolean): void {
    this.pulling = pulling;
  }

  /**
   * Emits every status and stroke due up to `now`. Samples are stamped with
   * their scheduled clock time, which is what Clock.now() would have returned
   * had the timer fired exactly then; this keeps spacing correct at 20×.
   */
  advance(now: number): void {
    if (this.connectionState !== 'connected') return;
    while (Math.min(this.nextStatusAt, this.nextStrokeAt) <= now) {
      if (this.nextStrokeAt <= this.nextStatusAt) this.emitStroke(this.nextStrokeAt);
      else this.emitStatus(this.nextStatusAt);
    }
  }

  private emitStroke(t: number): void {
    const pulling = this.mode === 'manual' ? this.pulling : true;
    const base = this.power;
    if (!pulling || base <= 0) {
      this.nextStrokeAt = t + IDLE_POLL_S;
      return;
    }
    let factor = 1 + gaussian(this.random) * POWER_NOISE_SD;
    if (this.mode === 'followTarget' && this.random() < DEVIATION_PROBABILITY) {
      factor *= this.random() < 0.5 ? 1 - DEVIATION : 1 + DEVIATION;
    }
    let power = Math.max(0, Math.round(base * factor));
    if (this.mode === 'fatigue') power = Math.min(power, Math.floor(this.trueMpa));
    const rate = Math.max(1, baseStrokeRate(power) + gaussian(this.random) * STROKE_RATE_NOISE_SD);

    this.strokeCount += 1;
    this.lastStrokeAt = t;
    this.lastPower = power;
    this.lastRate = rate;
    this.nextStrokeAt = t + 60 / rate;
    this.strokes.emit({
      ts: t,
      pmElapsed: t - this.startTs,
      power,
      strokeRate: Math.round(rate),
      strokeCount: this.strokeCount,
      distance: this.distance,
    });
  }

  private emitStatus(t: number): void {
    // Like an athlete at "go": a clear step up in wanted power shortens the stroke in
    // progress to the new rate instead of finishing the slow stroke first.
    const wanted = this.power;
    if (this.mode !== 'manual' && this.lastPower > 0 && wanted > this.lastPower * STEP_UP) {
      this.nextStrokeAt = Math.min(this.nextStrokeAt, Math.max(t + MIN_DRIVE_S, this.lastStrokeAt + 60 / baseStrokeRate(wanted)));
    }
    const moving = t - this.lastStrokeAt <= IDLE_AFTER_S;
    const speed = moving ? speedFromPower(this.lastPower) : 0;
    this.trueWbal = wbalStep(this.trueWbal, moving ? this.lastPower : 0, this.trueSignature, STATUS_INTERVAL_S);
    this.distance += speed * STATUS_INTERVAL_S;
    this.nextStatusAt = t + STATUS_INTERVAL_S;
    this.statuses.emit({
      ts: t,
      pmElapsed: t - this.startTs,
      distance: this.distance,
      strokeRate: moving ? Math.round(this.lastRate) : 0,
      paceSecPer500: speed > 0 ? 500 / speed : undefined,
    });
  }
}
