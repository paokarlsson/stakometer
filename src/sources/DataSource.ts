import { Emitter, type Unsubscribe } from '../core/events';
import { measurements, type Measurement, type TrainingDevice } from './TrainingDevice';

/** 'trainer' is a smart bike trainer over Bluetooth (FTMS or Cycling Power). */
export type Machine = 'skierg' | 'rowerg' | 'bikeerg' | 'trainer';

/** Training form; picks the labels and units in the UI. */
export type Sport = 'skierg' | 'bike';

export const sportOf = (machine: Machine): Sport => (machine === 'bikeerg' || machine === 'trainer' ? 'bike' : 'skierg');

/** One power sample: a stroke from the PM5, or one notification from a bike trainer. */

export interface StrokeSample {
  ts: number; // Clock.now() when received
  pmElapsed: number; // s, from the device (a trainer without its own clock: since connect)
  power: number; // W, power for the stroke
  strokeRate: number; // strokes/min, or crank rpm on a bike; 0 when unknown
  strokeCount: number; // strokes, or samples on a bike
  distance?: number; // m, total; missing when the device gives none
  raw?: Record<string, number>; // other parsed fields, stored unchanged
}

export interface StatusSample {
  ts: number;
  pmElapsed: number;
  distance?: number; // missing when the device gives none (some bike trainers)
  strokeRate?: number; // strokes/min, or crank rpm on a bike
  heartRate?: number; // only when the device delivers a valid value
  paceSecPer500?: number;
  speed?: number; // m/s, bike trainers only
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

/** One raw message from the PM5 as hex, for the debug log and fixtures. */
export interface RawNotification {
  ts: number;
  /** BLE characteristic (e.g. '0036') or HID input report (e.g. 'hid2'). */
  char: string;
  hex: string;
}

export type SourceKind = 'pm5' | 'trainer' | 'simulator';

export interface DataSource {
  readonly kind: SourceKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onStroke(cb: (s: StrokeSample) => void): Unsubscribe;
  onStatus(cb: (s: StatusSample) => void): Unsubscribe;
  onConnection(cb: (c: ConnectionState) => void): Unsubscribe;
  machine(): Machine | null; // null when the machine type is unknown
}

/** Shared listener plumbing for DataSource implementations. */
export abstract class BaseSource implements TrainingDevice {
  abstract readonly kind: SourceKind;
  protected readonly strokes = new Emitter<StrokeSample>();
  protected readonly statuses = new Emitter<StatusSample>();
  protected readonly connections = new Emitter<ConnectionState>();
  protected connectionState: ConnectionState = 'disconnected';

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract machine(): Machine | null;

  onStroke(cb: (s: StrokeSample) => void): Unsubscribe {
    return this.strokes.on(cb);
  }

  onStatus(cb: (s: StatusSample) => void): Unsubscribe {
    return this.statuses.on(cb);
  }

  onConnection(cb: (c: ConnectionState) => void): Unsubscribe {
    return this.connections.on(cb);
  }

  onMeasurement(cb: (m: Measurement) => void): Unsubscribe {
    return measurements(this, cb);
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  protected setConnection(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    this.connections.emit(state);
  }
}
