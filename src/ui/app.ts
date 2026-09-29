import { RealClock, type Clock } from '../core/clock';
import { Emitter } from '../core/events';
import { defaultPm5Signature, simulatorSignature, type FitnessSignature } from '../model/signature';
import { analyzeSession } from '../session/analysis';
import { testResultFrom } from '../session/testResults';
import type { ConnectionState, DataSource, Machine } from '../sources/DataSource';
import type { Pm5Source } from '../sources/pm5/ble';
import { UsbPm5Source } from '../sources/pm5/usb';
import { RawLog } from '../sources/rawlog';
import type { Simulator } from '../sources/simulator';
import type { IdbStore } from '../storage/db';
import { DEFAULT_SETTINGS, settingsFromRecords, settingsToRecords, wbalOptions, type Settings } from '../storage/settings';
import type { Session, TestResult } from '../storage/types';
import type { Workout } from '../workout/schema';
import { Beeper } from './audio';

export type ViewName = 'start' | 'live' | 'history' | 'session' | 'settings';

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
  /** Current target in W, read by the simulator. Set by the live view. */
  target: () => number | null = () => null;
  /** Duration of the maximal effort in progress, read by the simulator's fatigue mode. */
  maxEffort: () => number | null = () => null;
  /** The session shown by the session view. */
  sessionId: string | null = null;
  settings: Settings = DEFAULT_SETTINGS;
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

  async loadSettings(): Promise<void> {
    this.settings = settingsFromRecords(await this.store.getSettingRecords());
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.store.putSettingRecords(settingsToRecords(settings));
    this.settings = settings;
  }

  /** The machine in use: the manual choice in settings, else what the PM reports, else SkiErg (spec §8.5). */
  machine(): Machine {
    const choice = this.settings.machine;
    return choice !== 'auto' ? choice : (this.source?.machine() ?? 'skierg');
  }

  /**
   * Active signature for the connected machine: the latest stored one, otherwise
   * the default values for the source (spec §5.1). Signatures fitted from simulator
   * tests are only used with the simulator. Null when nothing is connected.
   */
  async activeSignature(): Promise<FitnessSignature | null> {
    const source = this.source;
    if (!source) return null;
    const machine = this.machine();
    const simulated = source.kind === 'simulator';
    const stored = await this.store.latestSignature(machine, simulated);
    return stored ?? (simulated ? simulatorSignature(machine) : defaultPm5Signature(machine));
  }

  /** After a session: stores the test result of a completed test (spec §7.3). */
  async completeSession(session: Session): Promise<TestResult | null> {
    if (session.mode !== 'test') return null;
    const analysis = analyzeSession(session, await this.store.getChunks(session.id), wbalOptions(this.settings));
    const result = testResultFrom(session, analysis);
    if (result) await this.store.putTestResult(result);
    return result;
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
