import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FitnessSignature } from '../model/signature';
import type { Machine } from '../sources/DataSource';
import type { Chunk, Session, SessionStore } from './types';

export const DB_NAME = 'skierg-training';
export const DB_VERSION = 1;

export interface TestResult {
  id: string;
  sessionId: string;
  machine: Machine;
  duration: number; // s
  avgPower: number; // W
  date: string; // ISO 8601
}

interface Schema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { startedAt: string } };
  chunks: { key: [string, number]; value: Chunk };
  signatures: { key: string; value: FitnessSignature; indexes: { machine: Machine } };
  testResults: { key: string; value: TestResult; indexes: { machineDuration: [Machine, number] } };
  settings: { key: string; value: { key: string; value: unknown } };
}

export type Db = IDBPDatabase<Schema>;

export function openDb(name = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
      db.createObjectStore('signatures', { keyPath: 'id' }).createIndex('machine', 'machine');
      db.createObjectStore('testResults', { keyPath: 'id' }).createIndex('machineDuration', ['machine', 'duration']);
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  });
}

export class IdbStore implements SessionStore {
  constructor(private readonly db: Db) {}

  static async open(name = DB_NAME): Promise<IdbStore> {
    return new IdbStore(await openDb(name));
  }

  async putSession(session: Session): Promise<void> {
    await this.db.put('sessions', session);
  }

  getSession(id: string): Promise<Session | undefined> {
    return this.db.get('sessions', id);
  }

  async listSessions(): Promise<Session[]> {
    return (await this.db.getAllFromIndex('sessions', 'startedAt')).reverse();
  }

  async putChunk(chunk: Chunk): Promise<void> {
    await this.db.put('chunks', chunk);
  }

  /** The active signature for a machine: the latest one (spec §5.1). */
  async latestSignature(machine: Machine): Promise<FitnessSignature | null> {
    const all = await this.db.getAllFromIndex('signatures', 'machine', machine);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  getChunks(sessionId: string): Promise<Chunk[]> {
    return this.db.getAll('chunks', IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]));
  }
}
