import { RealClock, type Clock } from '../core/clock';
import { Emitter } from '../core/events';
import type { ConnectionState, DataSource } from '../sources/DataSource';
import type { Pm5Source } from '../sources/pm5/ble';
import { UsbPm5Source } from '../sources/pm5/usb';
import type { Simulator } from '../sources/simulator';
import type { IdbStore } from '../storage/db';

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
    this.sourceChanged.emit(this.connection);
  }

  async disconnect(): Promise<void> {
    const source = this.source;
    this.source = null;
    this.clock = null;
    this.offConnection?.();
    this.offConnection = null;
    await source?.disconnect();
    this.sourceChanged.emit('disconnected');
  }
}
