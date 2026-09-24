// PM5 over Web Bluetooth (spec §9). Connection, machine type and 0036 follow
// demo/public/game/sources/ble.js, which works against a real PM5. The other
// characteristics are [VERIFY] and optional: only stroke data is required.
import type { Clock } from '../../core/clock';
import { Emitter } from '../../core/events';
import { BaseSource, type Machine } from '../DataSource';
import { CHAR, MACHINE_TYPE_SKIERG, MULTIPLEX_ID_ADDITIONAL_STROKE, SAMPLE_RATE, SERVICE } from './uuids';
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
  readonly transport = 'ble' as const;
  /** Every notification as hex, for debug logging and fixtures. */
  readonly raw = new Emitter<RawNotification>();

  private device: BluetoothDevice | null = null;
  private userDisconnect = false;
  private general: GeneralStatus | null = null;
  private additional: AdditionalStatus | null = null;
  private additional2: AdditionalStatus2 | null = null;
  private strokeData: StrokeData | null = null;
  private lastStrokeCount: number | null = null;
  /** Raw erg machine type from 0016, null if it could not be read. */
  machineTypeCode: number | null = null;

  /** `showAll` lists every nearby device, for when the PM5 does not match the filters. */
  constructor(
    private readonly clock: Clock,
    private readonly opts: { showAll?: boolean } = {},
  ) {
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
    const optionalServices = [SERVICE.discovery, SERVICE.deviceInfo, SERVICE.control, SERVICE.rowing];
    // Filter on the advertised discovery service, not the name: the name may be
    // missing from the advertisement on Windows.
    const device = await navigator.bluetooth.requestDevice(
      this.opts.showAll
        ? { acceptAllDevices: true, optionalServices }
        : { filters: [{ services: [SERVICE.discovery] }], optionalServices },
    );
    this.device = device;
    this.userDisconnect = false;
    try {
      await this.setup();
    } catch (err) {
      device.gatt?.disconnect();
      this.device = null;
      throw new Error(`Kunde inte ansluta till ${device.name ?? 'enheten'}. Är det en PM5? (${err instanceof Error ? err.message : err})`);
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

  machine(): Machine | null {
    // Only the SkiErg value is known; anything else falls back to the settings choice.
    return this.machineTypeCode === MACHINE_TYPE_SKIERG ? 'skierg' : null;
  }

  private async setup(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('PM5 saknar GATT-server.');
    const server = await gatt.connect();

    try {
      const info = await server.getPrimaryService(SERVICE.deviceInfo);
      this.machineTypeCode = (await (await info.getCharacteristic(CHAR.machineType)).readValue()).getUint8(0);
    } catch (err) {
      console.warn('PM5: could not read machine type:', err);
    }

    const rowing = await server.getPrimaryService(SERVICE.rowing);
    try {
      await (await rowing.getCharacteristic(CHAR.sampleRate)).writeValue(new Uint8Array([SAMPLE_RATE.ms100]));
    } catch (err) {
      console.warn('PM5: could not set sample rate:', err);
    }

    const subscribe = async (uuid: string, handle: (v: DataView) => void): Promise<boolean> => {
      try {
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
        return true;
      } catch (err) {
        console.warn(`PM5: no notifications on ${uuid.slice(4, 8)}:`, err);
        return false;
      }
    };

    // Stroke data is required; the multiplexed characteristic is the fallback.
    const strokes =
      (await subscribe(CHAR.additionalStrokeData, this.onAdditionalStrokeData)) ||
      (await subscribe(CHAR.multiplexed, this.onMultiplexed));
    if (!strokes) throw new Error('PM5 skickar ingen dragdata (varken 0036 eller 0080).');

    await subscribe(CHAR.generalStatus, this.onGeneralStatus);
    await subscribe(CHAR.additionalStatus, (v) => (this.additional = parseAdditionalStatus(v)));
    await subscribe(CHAR.additionalStatus2, (v) => (this.additional2 = parseAdditionalStatus2(v)));
    await subscribe(CHAR.strokeData, (v) => (this.strokeData = parseStrokeData(v)));
  }

  private readonly onMultiplexed = (v: DataView): void => {
    if (v.byteLength > 0 && v.getUint8(0) === MULTIPLEX_ID_ADDITIONAL_STROKE) {
      this.onAdditionalStrokeData(new DataView(v.buffer, v.byteOffset + 1, v.byteLength - 1));
    }
  };

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

    const raw: Record<string, number> = { strokeCalories: d.strokeCalories };
    if (d.projectedWorkTime !== null) raw.projectedWorkTime = d.projectedWorkTime;
    if (d.projectedWorkDistance !== null) raw.projectedWorkDistance = d.projectedWorkDistance;
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
