// Smart bike trainer over Web Bluetooth, e.g. Wahoo KICKR CORE in a Zwift Ride. FTMS Indoor
// Bike Data is preferred; Cycling Power Measurement is the fallback when FTMS is missing.
// Read-only: only notifications are subscribed to and nothing is written to the trainer, so
// Zwift (or another app) can control the resistance at the same time.
import type { Clock } from '../../core/clock';
import { Emitter } from '../../core/events';
import { retryConnect } from '../bleReconnect';
import { BaseSource, type Machine, type RawNotification, type StatusSample, type StrokeSample } from '../DataSource';
import { toHex } from '../pm5/parse';
import { CadenceTracker, parseCyclingPower } from './cps';
import { IndoorBikeDataJoiner, parseIndoorBikeData, type IndoorBikeData } from './ftms';
import { CHAR, SERVICE } from './uuids';

export type BikeProtocol = 'ftms' | 'cps';

/** One complete reading from the trainer, in app units. Missing fields were not sent. */
export interface BikeReading {
  power?: number; // W
  cadence?: number; // rpm
  speed?: number; // m/s
  distance?: number; // m
  heartRate?: number; // bpm
  elapsed?: number; // s, the trainer's own clock
  raw?: Record<string, number>;
}

/** FTMS fields → a reading; unused FTMS fields go in `raw`. */
export function readingFromFtms(d: Omit<IndoorBikeData, 'moreData'>): BikeReading {
  const r: BikeReading = {};
  if (d.power !== undefined) r.power = d.power;
  if (d.cadence !== undefined) r.cadence = d.cadence;
  if (d.speed !== undefined) r.speed = d.speed / 3.6;
  if (d.distance !== undefined) r.distance = d.distance;
  // 0 means "no heart rate" on many trainers.
  if (d.heartRate !== undefined && d.heartRate > 0) r.heartRate = d.heartRate;
  if (d.elapsed !== undefined) r.elapsed = d.elapsed;
  const raw: Record<string, number> = {};
  for (const k of ['avgSpeed', 'avgCadence', 'resistance', 'avgPower', 'energyTotal', 'energyPerHour', 'energyPerMinute', 'met', 'remaining'] as const) {
    const v = d[k];
    if (v !== undefined) raw[k] = v;
  }
  if (Object.keys(raw).length > 0) r.raw = raw;
  return r;
}

export class BikeSource extends BaseSource {
  readonly kind = 'trainer' as const;
  readonly transport = 'ble' as const;
  /** Every notification as hex, for debug logging and fixtures. */
  readonly raw = new Emitter<RawNotification>();
  /** Which protocol the trainer is read with, null before connecting. */
  protocol: BikeProtocol | null = null;
  readonly machineTypeCode = null;

  private device: BluetoothDevice | null = null;
  private userDisconnect = false;
  private connectedAt = 0;
  private samples = 0;
  private readonly joiner = new IndoorBikeDataJoiner();
  private readonly cadence = new CadenceTracker();

  constructor(private readonly clock: Clock) {
    super();
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /** Must be called from a user gesture. */
  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth stöds inte i den här webbläsaren.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE.ftms] }, { services: [SERVICE.cyclingPower] }],
      optionalServices: [SERVICE.ftms, SERVICE.cyclingPower],
    });
    this.device = device;
    this.userDisconnect = false;
    this.connectedAt = this.clock.now();
    this.samples = 0;
    try {
      await this.setup();
    } catch (err) {
      device.gatt?.disconnect();
      this.device = null;
      throw new Error(`Kunde inte ansluta till ${device.name ?? 'trainern'}. (${err instanceof Error ? err.message : err})`);
    }
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.setConnection('connected');
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.device?.gatt?.disconnect();
    this.setConnection('disconnected');
  }

  machine(): Machine {
    return 'trainer';
  }

  /** Also called from the UI ("Återanslut") after automatic reconnecting gave up. */
  async reconnect(): Promise<void> {
    if (!this.device || this.connectionState === 'reconnecting') return;
    this.setConnection('reconnecting');
    const ok = await retryConnect(() => this.setup(), () => this.userDisconnect, 'Trainer');
    if (this.userDisconnect) return;
    this.setConnection(ok ? 'connected' : 'disconnected');
  }

  private async setup(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('Trainern saknar GATT-server.');
    const server = await gatt.connect();
    this.cadence.reset();

    const ftms = await server.getPrimaryService(SERVICE.ftms).catch(() => null);
    if (ftms) {
      try {
        await this.subscribe(await ftms.getCharacteristic(CHAR.indoorBikeData), '2ad2', this.onIndoorBikeData);
        this.protocol = 'ftms';
        return;
      } catch (err) {
        console.warn('Trainer: FTMS without Indoor Bike Data, trying Cycling Power:', err);
      }
    }
    const cps = await server.getPrimaryService(SERVICE.cyclingPower).catch(() => null);
    if (!cps) throw new Error('Trainern har varken FTMS (0x1826) eller Cycling Power (0x1818).');
    await this.subscribe(await cps.getCharacteristic(CHAR.cyclingPowerMeasurement), '2a63', this.onCyclingPower);
    this.protocol = 'cps';
  }

  private async subscribe(ch: BluetoothRemoteGATTCharacteristic, char: string, handle: (v: DataView) => void): Promise<void> {
    ch.addEventListener('characteristicvaluechanged', () => {
      if (!ch.value) return;
      if (this.raw.size > 0) this.raw.emit({ ts: this.clock.now(), char, hex: toHex(ch.value) });
      try {
        handle(ch.value);
      } catch (err) {
        console.warn(`Trainer ${char}:`, err);
      }
    });
    await ch.startNotifications();
  }

  private readonly onIndoorBikeData = (v: DataView): void => {
    const record = this.joiner.push(parseIndoorBikeData(v));
    if (record) this.emitReading(readingFromFtms(record));
  };

  private readonly onCyclingPower = (v: DataView): void => {
    const d = parseCyclingPower(v);
    const r: BikeReading = { power: d.power };
    if (d.crankRevs !== undefined && d.crankEventTime !== undefined) {
      const c = this.cadence.update(d.crankRevs, d.crankEventTime, this.clock.now());
      if (c !== null) r.cadence = c;
    }
    // Speed would need a wheel circumference, which the trainer does not give, so it is left out.
    const raw: Record<string, number> = {};
    if (d.pedalBalance !== undefined) raw.pedalBalance = d.pedalBalance;
    if (d.accumulatedTorque !== undefined) raw.accumulatedTorque = d.accumulatedTorque;
    if (d.wheelRevs !== undefined) raw.wheelRevs = d.wheelRevs;
    if (d.wheelEventTime !== undefined) raw.wheelEventTime = d.wheelEventTime;
    if (d.crankRevs !== undefined) raw.crankRevs = d.crankRevs;
    if (d.crankEventTime !== undefined) raw.crankEventTime = d.crankEventTime;
    if (Object.keys(raw).length > 0) r.raw = raw;
    this.emitReading(r);
  };

  /** A reading becomes a power sample (when it has power) and a status. Shared with the simulator. */
  emitReading(r: BikeReading): void {
    emitBikeReading(this.strokes, this.statuses, r, this.clock.now(), r.elapsed ?? this.clock.now() - this.connectedAt, ++this.samples);
  }

  private readonly onGattDisconnected = (): void => {
    if (this.userDisconnect) return;
    void this.reconnect();
  };
}

/** Emits a bike reading on the DataSource events: power as a "stroke", the rest as a status. */
export function emitBikeReading(
  strokes: Emitter<StrokeSample>,
  statuses: Emitter<StatusSample>,
  r: BikeReading,
  ts: number,
  elapsed: number,
  sample: number,
): void {
  if (r.power !== undefined) {
    strokes.emit({
      ts,
      pmElapsed: elapsed,
      power: Math.max(0, r.power),
      strokeRate: r.cadence ?? 0,
      strokeCount: sample,
      ...(r.distance !== undefined && { distance: r.distance }),
      ...(r.raw && { raw: r.raw }),
    });
  }
  statuses.emit({
    ts,
    pmElapsed: elapsed,
    ...(r.distance !== undefined && { distance: r.distance }),
    ...(r.cadence !== undefined && { strokeRate: r.cadence }),
    ...(r.heartRate !== undefined && { heartRate: r.heartRate }),
    ...(r.speed !== undefined && { speed: r.speed }),
  });
}

