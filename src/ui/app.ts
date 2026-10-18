import { RealClock, type Clock, type SimSpeed } from '../core/clock';
import { Emitter } from '../core/events';
import { defaultSignature, simulatorSignature, type FitnessSignature } from '../model/signature';
import { analyzeSession } from '../session/analysis';
import { testResultFrom } from '../session/testResults';
import type { BikeSource } from '../sources/bike/ble';
import type { BikeSimulator } from '../sources/bike/simulator';
import { sportOf, type ConnectionState, type DataSource, type Machine, type Sport } from '../sources/DataSource';
import type { Pm5Source } from '../sources/pm5/ble';
import { UsbPm5Source } from '../sources/pm5/usb';
import { RawLog } from '../sources/rawlog';
import { DEFAULT_DRAG_FACTOR, type SimMode, type Simulator } from '../sources/simulator';
import type { IdbStore } from '../storage/db';
import { DEFAULT_SETTINGS, settingsFromRecords, settingsToRecords, wbalOptions, type Settings } from '../storage/settings';
import type { Session, TestResult } from '../storage/types';
import type { Workout } from '../workout/schema';
import { Beeper } from './audio';

export type ViewName = 'start' | 'workouts' | 'workout' | 'live' | 'history' | 'session' | 'settings';

/** The lists of workouts reached from the start page. */
export type WorkoutCategory = 'planned' | 'builtin' | 'test';

/** Simulator choices on the start page, kept while the app runs. */
export interface SimChoices {
  speed: SimSpeed;
  mode: SimMode;
  dragFactor: number;
  sport: Sport;
}

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
  /** The list the workout was chosen from; null when chosen on the start page itself. */
  category: WorkoutCategory | null = null;
  sim: SimChoices = { speed: 1, mode: 'followTarget', dragFactor: DEFAULT_DRAG_FACTOR, sport: 'skierg' };
  /** Current target in W, read by the simulator. Set by the live view. */
  target: () => number | null = () => null;
  /** Duration of the maximal effort in progress, read by the simulator's fatigue mode. */
  maxEffort: () => number | null = () => null;
  /** The session shown by the session view, and where its back arrow leads. */
  sessionId: string | null = null;
  sessionBack: ViewName = 'start';
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

  get simulator(): Simulator | BikeSimulator | null {
    return this.source?.kind === 'simulator' ? (this.source as Simulator | BikeSimulator) : null;
  }

  get pm5(): Pm5Source | UsbPm5Source | null {
    return this.source?.kind === 'pm5' ? (this.source as Pm5Source | UsbPm5Source) : null;
  }

  get trainer(): BikeSource | null {
    return this.source?.kind === 'trainer' ? (this.source as BikeSource) : null;
  }

  /** The connected Bluetooth device, PM5 or trainer, when it can be reconnected after a drop. */
  get reconnectable(): { reconnect(): Promise<void> } | null {
    const s = this.source as Partial<{ reconnect(): Promise<void> }> | null;
    return s && typeof s.reconnect === 'function' ? (s as { reconnect(): Promise<void> }) : null;
  }

  /** Training form of the machine in use. */
  sport(): Sport {
    return sportOf(this.machine());
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

  /**
   * The machine in use: a bike trainer is always 'trainer'; for a PM5 the manual choice in
   * settings, else what the PM reports, else SkiErg (spec §8.5).
   */
  machine(): Machine {
    const reported = this.source?.machine() ?? null;
    if (reported === 'trainer') return reported;
    const choice = this.settings.machine;
    return choice !== 'auto' ? choice : (reported ?? 'skierg');
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
    return stored ?? (simulated ? simulatorSignature(machine) : defaultSignature(machine));
  }

  /** The active signature, or the PM5's when nothing is connected (USB is the default). */
  async displaySignature(): Promise<FitnessSignature> {
    const active = await this.activeSignature();
    if (active) return active;
    const machine = this.machine();
    return (await this.store.latestSignature(machine, false)) ?? defaultSignature(machine);
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
