import { RealClock, type Clock } from '../core/clock';
import { Emitter } from '../core/events';
import { simulatorSignature, type FitnessSignature } from '../model/signature';
import type { ConnectionState, DataSource } from '../sources/DataSource';
import type { Pm5Source } from '../sources/pm5/ble';
import { UsbPm5Source } from '../sources/pm5/usb';
import { RawLog } from '../sources/rawlog';
import type { Simulator } from '../sources/simulator';
import type { IdbStore } from '../storage/db';
import type { Workout } from '../workout/schema';
import { Beeper } from './audio';

export type ViewName = 'start' | 'live' | 'history';

/** Tears down listeners and timers when leaving a view. */
export type Cleanup = () => void;
export type View = (root: HTMLElement, app: App) => Cleanup;

/** Shared app state passed to every view. */
export class App {
  source: DataSource | null = null;
  clock: Clock | null = null;
  /** Emits whenever the source or its connection state changes. */
  readonly sourceChanged = new Emitter<ConnectionState>();
  /** The workout chosen on the start page; null = free ride. */
  workout: Workout | null = null;
  /** Current target in W, read by the simulator's followTarget mode. Set by the live view. */
  target: () => number | null = () => null;
  readonly beeper = new Beeper();
  /** Debug log of raw PM data (settings §8.5, step 0). Kept across views. */
  readonly rawLog = new RawLog();
  private debug = false;
  private offRawLog: (() => void) | null = null;
  private offConnection: (() => void) | null = null;
  private connecting = false;

  constructor(
    readonly store: IdbStore,
    readonly navigate: (view: ViewName) => void,
  ) {}

  get simulator(): Simulator | null {
    return this.source?.kind === 'simulator' ? (this.source as Simulator) : null;
  }

  get pm5(): Pm5Source | UsbPm5Source | null {
    return this.source?.kind === 'pm5' ? (this.source as Pm5Source | UsbPm5Source) : null;
  }

  /**
   * Connects over USB when a PM already permitted for this site is plugged in.
   * USB is the default; Bluetooth is used only when chosen. No user gesture needed.
   */
  async autoConnectUsb(): Promise<void> {
    if (this.source || this.connecting) return;
    const device = await UsbPm5Source.findConnected();
    if (!device || this.source) return;
    const clock = new RealClock();
    await this.useSource(new UsbPm5Source(device, clock), clock);
  }

  /**
   * Active signature for the connected machine: the latest stored one, or the
   * simulator's placeholder values when running the simulator (spec §5.1).
   */
  async activeSignature(): Promise<FitnessSignature | null> {
    const machine = this.source?.machine() ?? 'skierg';
    return (await this.store.latestSignature(machine)) ?? (this.source?.kind === 'simulator' ? simulatorSignature(machine) : null);
  }

  get debugLogging(): boolean {
    return this.debug;
  }

  setDebugLogging(on: boolean): void {
    this.debug = on;
    this.offRawLog?.();
    this.offRawLog = on && this.source ? this.rawLog.attach(this.source) : null;
  }

  get connection(): ConnectionState {
    return (this.source as { state?: ConnectionState } | null)?.state ?? 'disconnected';
  }

  async useSource(source: DataSource, clock: Clock): Promise<void> {
    await this.disconnect();
    this.connecting = true;
    try {
      await source.connect();
    } finally {
      this.connecting = false;
    }
    this.offConnection = source.onConnection((state) => this.sourceChanged.emit(state));
    this.source = source;
    this.clock = clock;
    if (this.debug) this.offRawLog = this.rawLog.attach(source);
    this.sourceChanged.emit(this.connection);
  }

  async disconnect(): Promise<void> {
    const source = this.source;
    this.source = null;
    this.clock = null;
    this.offConnection?.();
    this.offConnection = null;
    this.offRawLog?.();
    this.offRawLog = null;
    await source?.disconnect();
    this.sourceChanged.emit('disconnected');
  }
}
