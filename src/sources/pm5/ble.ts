// PM5 over Web Bluetooth (spec §9). [VERIFY] Untested against a real PM5.
import type { Clock } from '../../core/clock';
import { Emitter } from '../../core/events';
import { BaseSource, type Machine } from '../DataSource';
import { CHAR, SAMPLE_RATE, SERVICE } from './uuids';
import {
  parseAdditionalStatus,
  parseAdditionalStatus2,
  parseAdditionalStrokeData,
  parseGeneralStatus,
  parseStrokeData,
  toHex,
  type AdditionalStatus,
  type AdditionalStatus2,
  type GeneralStatus,
  type StrokeData,
} from './parse';

const RECONNECT_DELAYS_S = [1, 2, 4, 8, 16];

export interface RawNotification {
  ts: number;
  char: string;
  hex: string;
}

export class Pm5Source extends BaseSource {
  readonly kind = 'pm5' as const;
  /** Every notification as hex, for debug logging and fixtures. */
  readonly raw = new Emitter<RawNotification>();

  private device: BluetoothDevice | null = null;
  private userDisconnect = false;
  private general: GeneralStatus | null = null;
  private additional: AdditionalStatus | null = null;
  private additional2: AdditionalStatus2 | null = null;
  private strokeData: StrokeData | null = null;
  private lastStrokeCount: number | null = null;

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
      filters: [{ namePrefix: 'PM5' }],
      optionalServices: [SERVICE.deviceInfo, SERVICE.control, SERVICE.rowing],
    });
    this.device = device;
    this.userDisconnect = false;
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
    await this.setup();
    this.setConnection('connected');
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.device?.gatt?.disconnect();
    this.setConnection('disconnected');
  }

  machine(): Machine | null {
    // The SkiErg value of the machine type enum in 0032 is unknown (spec §9.3).
    return null;
  }

  private async setup(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('PM5 saknar GATT-server.');
    const server = await gatt.connect();
    const rowing = await server.getPrimaryService(SERVICE.rowing);

    const rate = await rowing.getCharacteristic(CHAR.sampleRate);
    await rate.writeValue(new Uint8Array([SAMPLE_RATE.ms100]));

    const handlers: [string, (v: DataView) => void][] = [
      [CHAR.generalStatus, this.onGeneralStatus],
      [CHAR.additionalStatus, (v) => (this.additional = parseAdditionalStatus(v))],
      [CHAR.additionalStatus2, (v) => (this.additional2 = parseAdditionalStatus2(v))],
      [CHAR.strokeData, (v) => (this.strokeData = parseStrokeData(v))],
      [CHAR.additionalStrokeData, this.onAdditionalStrokeData],
    ];
    for (const [uuid, handle] of handlers) {
      const ch = await rowing.getCharacteristic(uuid);
      ch.addEventListener('characteristicvaluechanged', () => {
        if (!ch.value) return;
        if (this.raw.size > 0) this.raw.emit({ ts: this.clock.now(), char: uuid.slice(4, 8), hex: toHex(ch.value) });
        try {
          handle(ch.value);
        } catch (err) {
          console.warn(`PM5 ${uuid.slice(4, 8)}:`, err);
        }
      });
      await ch.startNotifications();
    }
  }

  private readonly onGeneralStatus = (v: DataView): void => {
    const g = parseGeneralStatus(v);
    this.general = g;
    const a = this.additional;
    this.statuses.emit({
      ts: this.clock.now(),
      pmElapsed: g.elapsed,
      distance: g.distance,
      strokeRate: a?.strokeRate,
      heartRate: a?.heartRate ?? undefined,
      paceSecPer500: a && a.currentPace > 0 ? a.currentPace : undefined,
    });
  };

  private readonly onAdditionalStrokeData = (v: DataView): void => {
    const d = parseAdditionalStrokeData(v);
    if (d.strokeCount === this.lastStrokeCount) return; // repeated notification for the same stroke
    this.lastStrokeCount = d.strokeCount;

    const raw: Record<string, number> = {
      strokeCalories: d.strokeCalories,
      projectedWorkTime: d.projectedWorkTime,
      projectedWorkDistance: d.projectedWorkDistance,
    };
    const sd = this.strokeData;
    if (sd) {
      raw.sdElapsed = sd.elapsed;
      raw.driveLength = sd.driveLength;
      raw.driveTime = sd.driveTime;
      raw.recoveryTime = sd.recoveryTime;
      raw.strokeDistance = sd.strokeDistance;
      raw.peakDriveForce = sd.peakDriveForce;
      raw.avgDriveForce = sd.avgDriveForce;
      raw.workPerStroke = sd.workPerStroke;
      raw.sdStrokeCount = sd.strokeCount;
    }
    if (this.general) raw.dragFactor = this.general.dragFactor;
    if (this.additional2) raw.pmAvgPower = this.additional2.averagePower;

    this.strokes.emit({
      ts: this.clock.now(),
      pmElapsed: d.elapsed,
      power: d.power,
      strokeRate: this.additional?.strokeRate ?? 0,
      strokeCount: d.strokeCount,
      distance: this.general?.distance ?? sd?.distance ?? 0,
      raw,
    });
  };

  private readonly onGattDisconnected = (): void => {
    if (this.userDisconnect) return;
    void this.reconnect();
  };

  private async reconnect(): Promise<void> {
    this.setConnection('reconnecting');
    for (const delay of RECONNECT_DELAYS_S) {
      await new Promise((r) => setTimeout(r, delay * 1000));
      if (this.userDisconnect) return;
      try {
        await this.setup();
        this.setConnection('connected');
        return;
      } catch (err) {
        console.warn('PM5 reconnect failed:', err);
      }
    }
    this.setConnection('disconnected');
  }
}
