import type { Clock } from '../core/clock';
import type { Unsubscribe } from '../core/events';
import type { FitnessSignature } from '../model/signature';
import type { WbalOptions } from '../model/wbal';
import type { DataSource, Machine } from '../sources/DataSource';
import type {
  ConnectionEvent,
  RecordedStatus,
  RunnerEvent,
  RecordedStroke,
  Session,
  SessionMode,
  SessionStatus,
  SessionStore,
} from '../storage/types';
import type { PlannedWorkout } from '../workout/plan';
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
  planned?: PlannedWorkout;
  timeline?: readonly TimelineSegment[] | null;
  signature?: FitnessSignature | null;
  /** Clock time of session t = 0; defaults to now. May be in the future (countdown). */
  startTs?: number;
  /** W′ model for the summary's lowest W′. */
  wbal?: WbalOptions;
}

/** Records raw samples from a DataSource into chunks written every CHUNK_INTERVAL_S. */
export class Recorder {
  private session: Session | null = null;
  private wbalOptions: WbalOptions | undefined;
  private startTs = 0;
  private lastFlushTs = 0;
  private seq = 0;
  private strokes: RecordedStroke[] = [];
  private status: RecordedStatus[] = [];
  private connection: ConnectionEvent[] = [];
  private runner: RunnerEvent[] = [];
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
      ...(opts.planned !== undefined && { planned: opts.planned }),
      timeline: opts.timeline ? [...opts.timeline] : null,
      signatureId: signature?.id ?? null,
      signatureSnapshot: signature,
      status: 'aborted',
      summary: null,
    };
    this.session = session;
    this.wbalOptions = opts.wbal;
    this.startTs = opts.startTs ?? this.clock.now();
    this.lastFlushTs = this.clock.now();
    this.seq = 0;
    this.strokes = [];
    this.status = [];
    this.connection = [];
    this.runner = [];
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

  /** Records a workout runner state change at the current time. */
  mark(state: string): void {
    if (!this.session) return;
    const now = this.clock.now();
    this.add(now, () => this.runner.push({ t: now - this.startTs, state }));
  }

  /** Writes buffered samples as a new chunk. Writes are serialised. */
  flush(): Promise<void> {
    const session = this.session;
    const empty = this.strokes.length + this.status.length + this.connection.length + this.runner.length === 0;
    if (!session || empty) return this.writes;
    const chunk = {
      sessionId: session.id,
      seq: this.seq++,
      strokes: this.strokes,
      status: this.status,
      ...(this.connection.length > 0 && { connection: this.connection }),
      ...(this.runner.length > 0 && { runner: this.runner }),
    };
    this.strokes = [];
    this.status = [];
    this.connection = [];
    this.runner = [];
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
    const done: Session = { ...session, status, summary: summarize(await this.store.getChunks(session.id), session.signatureSnapshot, this.wbalOptions) };
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
    const done: Session = { ...session, summary: summarize(await store.getChunks(session.id), session.signatureSnapshot) };
    await store.putSession(done);
    recovered.push(done);
  }
  return recovered;
}
