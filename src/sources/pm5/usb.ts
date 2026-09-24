// PM5 over USB via WebHID and CSAFE polling. Follows the working code in
// demo/public/pm5.js and demo/public/game/sources/usb.js.
//
// The PM has no notifications over USB, so the app polls. Stroke state and power
// every FAST_INTERVAL_MS; time, distance, pace, rate, heart rate and drag factor
// every METRICS_INTERVAL_MS. A stroke counts when the PM leaves the drive phase,
// and its power is taken from the next response, when the PM has updated it.
import type { Clock } from '../../core/clock';
import { Emitter } from '../../core/events';
import { BaseSource, type Machine, type StatusSample, type StrokeSample } from '../DataSource';
import type { RawNotification } from './ble';
import { buildFrame, CMD, FRAME_END, FRAME_START, parseFrame, PM, StrokeState, uintLE, type CsafeResponse } from './csafe';

export const CONCEPT2_VENDOR_ID = 0x17a4;
const FAST_INTERVAL_MS = 50;
const METRICS_INTERVAL_MS = 250;
const RESPONSE_TIMEOUT_MS = 1000;
const PROBE_TIMEOUT_MS = 700;
const MAX_ERRORS = 10;
const RETRY_MS = 2000;

/**
 * HID reports [id, bytes without the id byte], largest first. The PM answers in the
 * report it was asked in and truncates answers that do not fit, so #2 comes first.
 * The descriptor cannot be trusted (Windows reports 500 bytes for all three).
 */
const PM_REPORTS: readonly (readonly [number, number])[] = [
  [2, 120],
  [4, 62],
  [1, 20],
];

const FAST_FRAME = buildFrame([CMD.getPower], [PM.strokeState]);
const METRICS_FRAME = buildFrame(
  [CMD.getPace, CMD.getCadence, CMD.getPower, CMD.getHeartRate],
  [PM.workTime, PM.workDistance, PM.strokeState, PM.dragFactor],
);

/** Turns polled CSAFE responses into samples. Pure apart from its own state; unit tested. */
export class UsbDecoder {
  private strokeState: number | null = null;
  private pendingStroke = false;
  private strokeCount = 0;
  private last: StatusSample | null = null;
  private dragFactor: number | undefined;

  handle(r: CsafeResponse, ts: number): { status: StatusSample | null; stroke: StrokeSample | null } {
    const status = this.status(r, ts);

    let stroke: StrokeSample | null = null;
    const power = uintLE(r.std.get(CMD.getPower), 2);
    if (this.pendingStroke && power !== undefined) {
      this.pendingStroke = false;
      this.strokeCount += 1;
      stroke = {
        ts,
        pmElapsed: this.last?.pmElapsed ?? 0,
        power,
        strokeRate: this.last?.strokeRate ?? 0,
        strokeCount: this.strokeCount,
        distance: this.last?.distance ?? 0,
        raw: this.dragFactor !== undefined ? { dragFactor: this.dragFactor } : {},
      };
    }

    const state = r.pm.get(PM.strokeState)?.[0];
    if (state !== undefined) {
      if (this.strokeState === StrokeState.driving && state !== StrokeState.driving) this.pendingStroke = true;
      this.strokeState = state;
    }
    return { status, stroke };
  }

  private status(r: CsafeResponse, ts: number): StatusSample | null {
    const time = uintLE(r.pm.get(PM.workTime), 4);
    const distance = uintLE(r.pm.get(PM.workDistance), 4);
    if (time === undefined || distance === undefined) return null;
    const pace = uintLE(r.std.get(CMD.getPace), 2); // s/km
    const rate = uintLE(r.std.get(CMD.getCadence), 2);
    const hr = r.std.get(CMD.getHeartRate)?.[0];
    const drag = r.pm.get(PM.dragFactor)?.[0];
    if (drag !== undefined) this.dragFactor = drag;
    const status: StatusSample = {
      ts,
      pmElapsed: time / 100,
      distance: distance / 10,
      ...(rate !== undefined && { strokeRate: rate }),
      ...(hr !== undefined && hr > 0 && hr < 255 && { heartRate: hr }),
      ...(pace !== undefined && pace > 0 && { paceSecPer500: pace / 2 }),
    };
    this.last = status;
    return status;
  }
}

export class UsbPm5Source extends BaseSource {
  readonly kind = 'pm5' as const;
  readonly transport = 'usb' as const;
  /** Every frame as hex, for debug logging and fixtures. */
  readonly raw = new Emitter<RawNotification>();

  private device: HIDDevice | null;
  private report: readonly [number, number] | null = null;
  private descriptorSizes = new Map<number, number>();
  private pending: { resolve: (bytes: Uint8Array) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private polling = false;
  private reopening = false;
  private stopped = true;
  private decoder = new UsbDecoder();

  constructor(
    device: HIDDevice,
    private readonly clock: Clock,
  ) {
    super();
    this.device = device;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.hid;
  }

  /** A Concept2 PM already permitted for this site and plugged in. No user gesture needed. */
  static async findConnected(): Promise<HIDDevice | null> {
    if (!navigator.hid) return null;
    const devices = await navigator.hid.getDevices();
    return devices.find((d) => d.vendorId === CONCEPT2_VENDOR_ID) ?? null;
  }

  /** Shows Chrome's device chooser. Must be called from a user gesture. */
  static async request(): Promise<HIDDevice | null> {
    if (!navigator.hid) throw new Error('WebHID stöds inte i den här webbläsaren.');
    const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: CONCEPT2_VENDOR_ID }] });
    return device ?? null;
  }

  get deviceName(): string {
    return this.device?.productName || 'PM5';
  }

  async connect(): Promise<void> {
    const device = this.device;
    if (!device) throw new Error('Ingen PM vald.');
    this.stopped = false;
    navigator.hid?.addEventListener('disconnect', this.onUnplug);
    navigator.hid?.addEventListener('connect', this.onPlug);
    try {
      await this.open(device);
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.polling = false;
    navigator.hid?.removeEventListener('disconnect', this.onUnplug);
    navigator.hid?.removeEventListener('connect', this.onPlug);
    await this.close();
    this.setConnection('disconnected');
  }

  machine(): Machine | null {
    return null; // not available over CSAFE; the settings choice applies (spec §9.3)
  }

  private async open(device: HIDDevice): Promise<void> {
    if (!device.opened) await device.open();
    this.device = device;
    this.descriptorSizes = outputReportSizes(device);
    device.addEventListener('inputreport', this.onInput);
    this.report = await this.probe();
    this.setConnection('connected');
    void this.poll();
  }

  private async close(): Promise<void> {
    this.rejectPending(new Error('Stängd'));
    const device = this.device;
    if (!device) return;
    device.removeEventListener('inputreport', this.onInput);
    if (device.opened) await device.close().catch(() => {});
  }

  /** Tries the PM's reports, largest first, and keeps the first one it answers. */
  private async probe(): Promise<readonly [number, number]> {
    for (const report of PM_REPORTS) {
      this.report = report;
      try {
        await this.send(buildFrame([CMD.getStatus]), PROBE_TIMEOUT_MS);
        return report;
      } catch (err) {
        console.warn(`PM5 USB report #${report[0]}:`, err);
      }
    }
    this.report = null;
    throw new Error('PM5 svarar inte över USB. Stäng andra program som använder den (t.ex. ErgData eller Concept2 Utility).');
  }

  /** Sends a frame and resolves with the response frame's bytes (F1 … F2). */
  private send(frame: Uint8Array, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Uint8Array> {
    const device = this.device;
    const report = this.report;
    if (!device || !report) return Promise.reject(new Error('Ingen fungerande HID-rapport'));
    if (this.pending) return Promise.reject(new Error('Förfrågan pågår redan'));
    const [reportId, size] = report;
    if (frame.length > size) return Promise.reject(new Error(`Ramen (${frame.length} B) får inte plats i rapport #${reportId}`));
    // Pad to the descriptor's size when it is larger; Windows requires it.
    const data = new Uint8Array(Math.max(size, this.descriptorSizes.get(reportId) ?? 0));
    data.set(frame);

    const response = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Timeout – inget svar från PM'));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
    });
    if (this.raw.size > 0) this.raw.emit({ ts: this.clock.now(), char: `→hid${reportId}`, hex: hex(frame) });
    device.sendReport(reportId, data).catch((err: unknown) => {
      this.rejectPending(new Error(`sendReport #${reportId} misslyckades: ${err instanceof Error ? err.message : err}`));
    });
    return response;
  }

  private readonly onInput = (e: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    const start = bytes.indexOf(FRAME_START);
    // The whole answer comes in one report. Old bytes from the PM's buffer may follow F2, so cut there.
    const stop = start < 0 ? -1 : bytes.indexOf(FRAME_END, start + 1);
    if (this.raw.size > 0) {
      let end = bytes.length;
      while (end > 0 && bytes[end - 1] === 0) end--;
      this.raw.emit({ ts: this.clock.now(), char: `←hid${e.reportId}`, hex: hex(bytes.subarray(0, stop >= 0 ? stop + 1 : end)) });
    }
    const pending = this.pending;
    if (!pending || start < 0) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (stop < 0) pending.reject(new Error(`Svaret fick inte plats i rapport #${e.reportId} (${bytes.length} B) och klipptes`));
    else pending.resolve(bytes.slice(start, stop + 1));
  };

  private rejectPending(err: Error): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    let lastMetrics = -Infinity;
    let errors = 0;
    while (this.polling && !this.stopped) {
      const started = performance.now();
      try {
        const metrics = started - lastMetrics >= METRICS_INTERVAL_MS;
        if (metrics) lastMetrics = started;
        const bytes = await this.send(metrics ? METRICS_FRAME : FAST_FRAME);
        const r = parseFrame(bytes);
        if (r) {
          const { status, stroke } = this.decoder.handle(r, this.clock.now());
          if (status) this.statuses.emit(status);
          if (stroke) this.strokes.emit(stroke);
        }
        errors = 0;
      } catch (err) {
        if (!this.polling || this.stopped) break;
        console.warn('PM5 USB:', err);
        if (++errors >= MAX_ERRORS) {
          void this.lost();
          break;
        }
      }
      const wait = FAST_INTERVAL_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.polling = false;
  }

  /** Keeps retrying until the PM answers again or disconnect() is called. The session continues meanwhile. */
  private async lost(): Promise<void> {
    this.polling = false;
    await this.close();
    this.device = null;
    if (this.stopped) return;
    this.setConnection('reconnecting');
    const retry = async (): Promise<void> => {
      if (this.stopped || this.connectionState !== 'reconnecting') return;
      // The cable may still be in (only the PM went quiet); then no connect event comes.
      if (!(await this.reopen())) setTimeout(() => void retry(), RETRY_MS);
    };
    setTimeout(() => void retry(), RETRY_MS);
  }

  private async reopen(): Promise<boolean> {
    if (this.device) return true; // already reopened by the connect event
    if (this.reopening) return false;
    this.reopening = true;
    try {
      const device = await UsbPm5Source.findConnected();
      if (!device || this.stopped) return false;
      await this.open(device);
      return true;
    } catch (err) {
      console.warn('PM5 USB reopen:', err);
      await this.close();
      this.device = null;
      return false;
    } finally {
      this.reopening = false;
    }
  }

  private readonly onUnplug = (e: HIDConnectionEvent): void => {
    if (e.device === this.device) void this.lost();
  };

  private readonly onPlug = (e: HIDConnectionEvent): void => {
    if (e.device.vendorId === CONCEPT2_VENDOR_ID && this.connectionState === 'reconnecting') void this.reopen();
  };
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Report id → size in bytes according to the HID descriptor. */
function outputReportSizes(device: HIDDevice): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const c of device.collections) {
    for (const r of c.outputReports ?? []) {
      sizes.set(r.reportId, (r.items ?? []).reduce((sum, it) => sum + it.reportSize * it.reportCount, 0) / 8);
    }
  }
  return sizes;
}
