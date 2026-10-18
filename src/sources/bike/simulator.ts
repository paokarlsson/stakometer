// Simulated bike trainer: builds real FTMS Indoor Bike Data bytes and sends them through the
// same parser as the trainer, so the UI and the parser can be tried without hardware.
// No heart rate is sent, like most trainers, so missing values show as "–".
import type { Clock } from '../../core/clock';
import { mpa } from '../../model/mpa';
import { powerAt } from '../../model/morton3p';
import type { SignatureParams } from '../../model/signature';
import { wbalStep } from '../../model/wbal';
import { BaseSource, type Machine } from '../DataSource';
import { clamp, gaussian, POWER_NOISE_SD, TRUE_SIGNATURE, type SimMode } from '../simulator';
import { emitBikeReading, readingFromFtms } from './ble';
import { FLAG, IndoorBikeDataJoiner, parseIndoorBikeData, type IndoorBikeData } from './ftms';

export const BIKE_NOTIFY_INTERVAL_S = 0.5;
const CADENCE_NOISE_SD = 1.5;

/** Cadence in rpm for a given power, before noise. */
export const baseCadence = (power: number): number => clamp(80 + 0.05 * (power - 150), 60, 110);

/** Rough flat-road speed for a power: 200 W ≈ 32 km/h. m/s. */
export const bikeSpeedFromPower = (power: number): number => (power > 0 ? Math.cbrt(power / 0.284) : 0);

/** Encodes FTMS Indoor Bike Data. Fields left out are not sent; speed is sent when given. */
export function encodeIndoorBikeData(d: Omit<IndoorBikeData, 'moreData'>): DataView {
  const bytes: number[] = [];
  const u8 = (x: number) => bytes.push(x & 0xff);
  const u16 = (x: number) => bytes.push(x & 0xff, (x >> 8) & 0xff);
  const u24 = (x: number) => bytes.push(x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff);
  let flags = 0;
  if (d.speed === undefined) flags |= FLAG.moreData;
  else u16(Math.round(d.speed / 0.01));
  if (d.avgSpeed !== undefined) (flags |= FLAG.avgSpeed), u16(Math.round(d.avgSpeed / 0.01));
  if (d.cadence !== undefined) (flags |= FLAG.cadence), u16(Math.round(d.cadence / 0.5));
  if (d.avgCadence !== undefined) (flags |= FLAG.avgCadence), u16(Math.round(d.avgCadence / 0.5));
  if (d.distance !== undefined) (flags |= FLAG.distance), u24(Math.round(d.distance));
  if (d.resistance !== undefined) (flags |= FLAG.resistance), u16(d.resistance);
  if (d.power !== undefined) (flags |= FLAG.power), u16(Math.round(d.power));
  if (d.avgPower !== undefined) (flags |= FLAG.avgPower), u16(Math.round(d.avgPower));
  if (d.energyTotal !== undefined) (flags |= FLAG.energy), u16(d.energyTotal), u16(d.energyPerHour ?? 0), u8(d.energyPerMinute ?? 0);
  if (d.heartRate !== undefined) (flags |= FLAG.heartRate), u8(d.heartRate);
  if (d.met !== undefined) (flags |= FLAG.met), u8(Math.round(d.met / 0.1));
  if (d.elapsed !== undefined) (flags |= FLAG.elapsed), u16(d.elapsed);
  if (d.remaining !== undefined) (flags |= FLAG.remaining), u16(d.remaining);
  return new DataView(new Uint8Array([flags & 0xff, flags >> 8, ...bytes]).buffer);
}

export interface BikeSimulatorOptions {
  mode?: SimMode;
  target?: () => number | null;
  maxEffort?: () => number | null;
  trueSignature?: SignatureParams;
  freePower?: number;
  manualPower?: number;
  random?: () => number;
  tickMs?: number;
}

export class BikeSimulator extends BaseSource {
  readonly kind = 'simulator' as const;
  mode: SimMode;
  readonly trueSignature: SignatureParams;
  trueWbal: number;
  private readonly target: () => number | null;
  private readonly maxEffort: () => number | null;
  private readonly freePower: number;
  private readonly random: () => number;
  private readonly tickMs: number;
  private manualPower: number;
  private pedalling = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly joiner = new IndoorBikeDataJoiner();
  private startTs = 0;
  private nextAt = 0;
  private distance = 0;
  private samples = 0;

  constructor(
    private readonly clock: Clock,
    opts: BikeSimulatorOptions = {},
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
    this.tickMs = opts.tickMs ?? 50;
  }

  async connect(): Promise<void> {
    this.startTs = this.clock.now();
    this.nextAt = this.startTs + BIKE_NOTIFY_INTERVAL_S;
    this.distance = 0;
    this.samples = 0;
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
    return 'trainer';
  }

  get power(): number {
    if (this.mode === 'manual') return this.manualPower;
    if (this.mode === 'fatigue') {
      const max = this.maxEffort();
      if (max !== null) return powerAt(max, this.trueSignature);
    }
    return this.target() ?? this.freePower;
  }

  get isPulling(): boolean {
    return this.pedalling;
  }

  adjustPower(delta: number): void {
    this.manualPower = Math.max(0, this.manualPower + delta);
  }

  setPulling(pedalling: boolean): void {
    this.pedalling = pedalling;
  }

  /** Sends every notification due up to `now`, stamped with its scheduled time. */
  advance(now: number): void {
    if (this.connectionState !== 'connected') return;
    while (this.nextAt <= now) {
      this.notify(this.nextAt);
      this.nextAt += BIKE_NOTIFY_INTERVAL_S;
    }
  }

  private notify(t: number): void {
    const moving = this.mode !== 'manual' || this.pedalling;
    let power = moving ? Math.max(0, Math.round(this.power * (1 + gaussian(this.random) * POWER_NOISE_SD))) : 0;
    if (this.mode === 'fatigue') power = Math.min(power, Math.floor(mpa(this.trueWbal, this.trueSignature)));
    this.trueWbal = wbalStep(this.trueWbal, power, this.trueSignature, BIKE_NOTIFY_INTERVAL_S);
    const cadence = power > 0 ? Math.max(0, baseCadence(power) + gaussian(this.random) * CADENCE_NOISE_SD) : 0;
    const speed = bikeSpeedFromPower(power);
    this.distance += speed * BIKE_NOTIFY_INTERVAL_S;
    const bytes = encodeIndoorBikeData({
      speed: speed * 3.6,
      cadence,
      distance: this.distance,
      power,
      elapsed: Math.floor(t - this.startTs),
    });
    const record = this.joiner.push(parseIndoorBikeData(bytes));
    if (!record) return;
    // The trainer's elapsed time is whole seconds; the sample's own time keeps the spacing exact.
    emitBikeReading(this.strokes, this.statuses, readingFromFtms(record), t, t - this.startTs, ++this.samples);
  }
}
