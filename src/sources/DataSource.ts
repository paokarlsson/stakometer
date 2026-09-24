import { Emitter, type Unsubscribe } from '../core/events';

export type Machine = 'skierg' | 'rowerg' | 'bikeerg';

export interface StrokeSample {
  ts: number; // Clock.now() when received
  pmElapsed: number; // s, from PM5
  power: number; // W, power for the stroke
  strokeRate: number; // strokes/min
  strokeCount: number;
  distance: number; // m, total
  raw?: Record<string, number>; // other parsed fields, stored unchanged
}

export interface StatusSample {
  ts: number;
  pmElapsed: number;
  distance: number;
  strokeRate?: number;
  heartRate?: number; // only when the PM5 delivers a valid value
  paceSecPer500?: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

/** One raw message from the PM5 as hex, for the debug log and fixtures. */
export interface RawNotification {
  ts: number;
  /** BLE characteristic (e.g. '0036') or HID input report (e.g. 'hid2'). */
  char: string;
  hex: string;
}

export interface DataSource {
  readonly kind: 'pm5' | 'simulator';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onStroke(cb: (s: StrokeSample) => void): Unsubscribe;
  onStatus(cb: (s: StatusSample) => void): Unsubscribe;
  onConnection(cb: (c: ConnectionState) => void): Unsubscribe;
  machine(): Machine | null; // null when the machine type is unknown
}

/** Shared listener plumbing for DataSource implementations. */
export abstract class BaseSource implements DataSource {
  abstract readonly kind: 'pm5' | 'simulator';
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

  get state(): ConnectionState {
    return this.connectionState;
  }

  protected setConnection(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    this.connections.emit(state);
  }
}
