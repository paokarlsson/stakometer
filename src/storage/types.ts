import type { FitnessSignature } from '../model/signature';
import type { ConnectionState, Machine, StatusSample, StrokeSample } from '../sources/DataSource';
import type { TimelineSegment } from '../workout/schema';

export type SessionMode = 'workout' | 'test' | 'free';
export type SessionStatus = 'completed' | 'aborted';

export interface SessionSummary {
  duration: number; // s
  distance: number; // m
  strokeCount: number;
  avgPower: number | null; // W, from the 1 Hz series; null when there were no strokes
  workKJ: number; // kJ, from the 1 Hz series
  /** Lowest W′ balance as a fraction of W′ (may be negative) and when; null without a signature. */
  minWbal: { fraction: number; t: number } | null;
}

export interface Session {
  id: string;
  startedAt: string; // ISO 8601
  machine: Machine;
  source: 'pm5' | 'simulator';
  mode: SessionMode;
  workoutId?: string;
  timeline: TimelineSegment[] | null;
  signatureId: string | null;
  signatureSnapshot: FitnessSignature | null;
  /** Written as 'aborted' at start, so a crash leaves an aborted session. */
  status: SessionStatus;
  /** null until the session is stopped or recovered after a reload. */
  summary: SessionSummary | null;
}

/** Samples are stored with t = ts − session start instead of ts (spec §4.4). */
export type RecordedStroke = Omit<StrokeSample, 'ts'> & { t: number };
export type RecordedStatus = Omit<StatusSample, 'ts'> & { t: number };

export interface ConnectionEvent {
  t: number;
  state: ConnectionState;
}

/** Workout runner state change, so paused stretches are marked in the data (spec §6.3). */
export interface RunnerEvent {
  t: number;
  state: string;
}

export interface Chunk {
  sessionId: string;
  seq: number;
  strokes: RecordedStroke[];
  status: RecordedStatus[];
  /** Connection changes, so reconnect gaps are visible in the data (spec §9.1, §9.2). */
  connection?: ConnectionEvent[];
  runner?: RunnerEvent[];
  rawLog?: string[];
}

export interface SessionStore {
  putSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  /** Newest first. */
  listSessions(): Promise<Session[]>;
  putChunk(chunk: Chunk): Promise<void>;
  /** Ordered by seq. */
  getChunks(sessionId: string): Promise<Chunk[]>;
}
