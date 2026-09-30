import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FitnessSignature } from '../model/signature';
import type { Machine } from '../sources/DataSource';
import type { PlannedWorkout } from '../workout/plan';
import type { BackupTarget, StoreName } from './backup';
import type { Chunk, Session, SessionStore, TestResult } from './types';

export const DB_NAME = 'skierg-training';
/** 2 added `plannedWorkouts` (plan.md §4.1). */
export const DB_VERSION = 2;

interface Schema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { startedAt: string } };
  chunks: { key: [string, number]; value: Chunk };
  signatures: { key: string; value: FitnessSignature; indexes: { machine: Machine } };
  testResults: { key: string; value: TestResult; indexes: { machineDuration: [Machine, number] } };
  settings: { key: string; value: { key: string; value: unknown } };
  plannedWorkouts: { key: string; value: PlannedWorkout; indexes: { date: string } };
}

export type Db = IDBPDatabase<Schema>;

export function openDb(name = DB_NAME): Promise<Db> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
        db.createObjectStore('signatures', { keyPath: 'id' }).createIndex('machine', 'machine');
        db.createObjectStore('testResults', { keyPath: 'id' }).createIndex('machineDuration', ['machine', 'duration']);
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (oldVersion < 2) db.createObjectStore('plannedWorkouts', { keyPath: 'id' }).createIndex('date', 'date');
    },
  });
}

export class IdbStore implements SessionStore, BackupTarget {
  readonly dbVersion = DB_VERSION;

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

  /**
   * The active signature for a machine: the latest one (spec §5.1). Signatures
   * fitted from simulator tests only count for the simulator, and vice versa.
   */
  async latestSignature(machine: Machine, simulated = false): Promise<FitnessSignature | null> {
    const all = await this.db.getAllFromIndex('signatures', 'machine', machine);
    return all.filter((s) => !!s.simulated === simulated).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async putSignature(signature: FitnessSignature): Promise<void> {
    await this.db.put('signatures', signature);
  }

  async putTestResult(result: TestResult): Promise<void> {
    await this.db.put('testResults', result);
  }

  listTestResults(machine: Machine): Promise<TestResult[]> {
    return this.db.getAll('testResults').then((all) => all.filter((r) => r.machine === machine));
  }

  /** Adds or replaces planned workouts by id, all or nothing. */
  async putPlannedWorkouts(workouts: readonly PlannedWorkout[]): Promise<void> {
    const tx = this.db.transaction('plannedWorkouts', 'readwrite');
    await Promise.all([...workouts.map((w) => tx.store.put(w)), tx.done]);
  }

  listPlannedWorkouts(): Promise<PlannedWorkout[]> {
    return this.db.getAllFromIndex('plannedWorkouts', 'date');
  }

  async deletePlannedWorkout(id: string): Promise<void> {
    await this.db.delete('plannedWorkouts', id);
  }

  getSettingRecords(): Promise<{ key: string; value: unknown }[]> {
    return this.db.getAll('settings');
  }

  async putSettingRecords(records: readonly { key: string; value: unknown }[]): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
  }

  readAll(store: StoreName): Promise<unknown[]> {
    return this.db.getAll(store);
  }

  async writeAll(store: StoreName, records: readonly unknown[]): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r as never)), tx.done]);
  }

  getChunks(sessionId: string): Promise<Chunk[]> {
    return this.db.getAll('chunks', IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]));
  }
}
