import { Emitter, type Unsubscribe } from '../core/events';
import type { DataSource, RawNotification, StatusSample, StrokeSample } from './DataSource';

export type RawLogEntry =
  | ({ kind: 'raw' } & RawNotification)
  | ({ kind: 'stroke' } & StrokeSample)
  | ({ kind: 'status' } & StatusSample);

/** Downloadable debug log; files from a real PM5 go in tests/fixtures/ (spec §12 step 0). */
export interface RawLogFile {
  format: 'skierg-rawlog';
  version: 1;
  recordedAt: string; // ISO 8601
  source: DataSource['kind'];
  transport: 'usb' | 'ble' | null;
  machineTypeCode: number | null;
  entries: RawLogEntry[];
}

export const MAX_ENTRIES = 50_000;

interface RawCapable {
  raw: Emitter<RawNotification>;
  transport?: 'usb' | 'ble';
  machineTypeCode?: number | null;
}

/** Records raw PM messages next to the parsed strokes and statuses they produced. */
export class RawLog {
  entries: RawLogEntry[] = [];
  readonly added = new Emitter<RawLogEntry>();
  private source: (DataSource & Partial<RawCapable>) | null = null;
  private recordedAt = new Date().toISOString();

  attach(source: DataSource): Unsubscribe {
    this.source = source;
    const raw = (source as Partial<RawCapable>).raw;
    const offs = [
      source.onStroke((s) => this.push({ kind: 'stroke', ...s })),
      source.onStatus((s) => this.push({ kind: 'status', ...s })),
      ...(raw ? [raw.on((r) => this.push({ kind: 'raw', ...r }))] : []),
    ];
    return () => offs.forEach((off) => off());
  }

  clear(): void {
    this.entries = [];
    this.recordedAt = new Date().toISOString();
  }

  toFile(): RawLogFile {
    const s = this.source;
    return {
      format: 'skierg-rawlog',
      version: 1,
      recordedAt: this.recordedAt,
      source: s?.kind ?? 'pm5',
      transport: s?.transport ?? null,
      machineTypeCode: s?.machineTypeCode ?? null,
      entries: this.entries,
    };
  }

  private push(entry: RawLogEntry): void {
    if (this.entries.length >= MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES + 1);
    this.entries.push(entry);
    this.added.emit(entry);
  }
}
