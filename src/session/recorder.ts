import type { Clock } from '../core/clock';
import type { Unsubscribe } from '../core/events';
import type { FitnessSignature } from '../model/signature';
import type { DataSource, Machine } from '../sources/DataSource';
import type {
  ConnectionEvent,
  RecordedStatus,
  RecordedStroke,
  Session,
  SessionMode,
  SessionStatus,
  SessionStore,
} from '../storage/types';
import type { TimelineSegment } from '../workout/schema';
import { summarize } from './summary';

/** At most this much session time is lost if the browser crashes (spec §11). */
export const CHUNK_INTERVAL_S = 30;

export interface RecorderOptions {
  chunkIntervalS?: number;
  newId?: () => string;
  wallClock?: () => Date;
}

export interface StartOptions {
  mode: SessionMode;
  machine: Machine;
  workoutId?: string;
  timeline?: TimelineSegment[] | null;
  signature?: FitnessSignature | null;
}

/** Records raw samples from a DataSource into chunks written every CHUNK_INTERVAL_S. */
export class Recorder {
  private session: Session | null = null;
  private startTs = 0;
  private lastFlushTs = 0;
  private seq = 0;
  private strokes: RecordedStroke[] = [];
  private status: RecordedStatus[] = [];
  private connection: ConnectionEvent[] = [];
  private unsubscribe: Unsubscribe[] = [];
  private writes: Promise<void> = Promise.resolve();
  private readonly chunkIntervalS: number;
  private readonly newId: () => string;
  private readonly wallClock: () => Date;

  constructor(
    private readonly store: SessionStore,
    private readonly clock: Clock,
    opts: RecorderOptions = {},
  ) {
    this.chunkIntervalS = opts.chunkIntervalS ?? CHUNK_INTERVAL_S;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.wallClock = opts.wallClock ?? (() => new Date());
  }

  get active(): Session | null {
    return this.session;
  }

  /** Seconds since the session started, by the app clock. */
  elapsed(): number {
    return this.session ? this.clock.now() - this.startTs : 0;
  }

  async start(source: DataSource, opts: StartOptions): Promise<Session> {
    if (this.session) throw new Error('A session is already being recorded.');
    const signature = opts.signature ?? null;
    const session: Session = {
      id: this.newId(),
      startedAt: this.wallClock().toISOString(),
      machine: opts.machine,
      source: source.kind,
      mode: opts.mode,
      ...(opts.workoutId !== undefined && { workoutId: opts.workoutId }),
      timeline: opts.timeline ?? null,
      signatureId: signature?.id ?? null,
      signatureSnapshot: signature,
      status: 'aborted',
      summary: null,
    };
    this.session = session;
    this.startTs = this.clock.now();
    this.lastFlushTs = this.startTs;
    this.seq = 0;
    this.strokes = [];
    this.status = [];
    this.connection = [];
    await this.store.putSession(session);

    this.unsubscribe = [
      source.onStroke(({ ts, ...s }) => this.add(ts, () => this.strokes.push({ ...s, t: ts - this.startTs }))),
      source.onStatus(({ ts, ...s }) => this.add(ts, () => this.status.push({ ...s, t: ts - this.startTs }))),
      source.onConnection((state) => {
        const now = this.clock.now();
        this.add(now, () => this.connection.push({ t: now - this.startTs, state }));
      }),
    ];
    return session;
  }

  /** Writes buffered samples as a new chunk. Writes are serialised. */
  flush(): Promise<void> {
    const session = this.session;
    if (!session || (this.strokes.length === 0 && this.status.length === 0 && this.connection.length === 0)) {
      return this.writes;
    }
    const chunk = {
      sessionId: session.id,
      seq: this.seq++,
      strokes: this.strokes,
      status: this.status,
      ...(this.connection.length > 0 && { connection: this.connection }),
    };
    this.strokes = [];
    this.status = [];
    this.connection = [];
    this.lastFlushTs = this.clock.now();
    this.writes = this.writes.then(() => this.store.putChunk(chunk)).catch((err) => console.error('Chunk write failed:', err));
    return this.writes;
  }

  /** Resolves when all chunk writes started so far have finished. */
  settled(): Promise<void> {
    return this.writes;
  }

  async stop(status: SessionStatus): Promise<Session> {
    const session = this.session;
    if (!session) throw new Error('No session is being recorded.');
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    await this.flush();
    this.session = null;
    const done: Session = { ...session, status, summary: summarize(await this.store.getChunks(session.id)) };
    await this.store.putSession(done);
    return done;
  }

  private add(ts: number, push: () => void): void {
    push();
    if (ts - this.lastFlushTs >= this.chunkIntervalS) void this.flush();
  }
}

/**
 * Gives sessions interrupted by a reload or crash a summary computed from their chunks.
 * They keep status 'aborted'. Returns the recovered sessions.
 */
export async function recoverUnfinished(store: SessionStore): Promise<Session[]> {
  const recovered: Session[] = [];
  for (const session of await store.listSessions()) {
    if (session.summary) continue;
    const done: Session = { ...session, summary: summarize(await store.getChunks(session.id)) };
    await store.putSession(done);
    recovered.push(done);
  }
  return recovered;
}
