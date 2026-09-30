// Backup of the whole database as JSON (spec §11, §8.5).

export const STORE_NAMES = ['sessions', 'chunks', 'signatures', 'testResults', 'settings', 'plannedWorkouts'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** Stores added after the first version (dbVersion 2: planned workouts). Older backups lack them. */
const LATER_STORES: readonly StoreName[] = ['plannedWorkouts'];

export interface BackupFile {
  format: 'skierg-backup';
  version: 1;
  dbVersion: number;
  exportedAt: string; // ISO 8601
  stores: Record<StoreName, unknown[]>;
}

/** What the backup needs from a database. */
export interface BackupTarget {
  readonly dbVersion: number;
  readAll(store: StoreName): Promise<unknown[]>;
  /** Adds or replaces records by key. */
  writeAll(store: StoreName, records: readonly unknown[]): Promise<void>;
}

export async function exportBackup(db: BackupTarget, now = new Date()): Promise<BackupFile> {
  const stores = {} as Record<StoreName, unknown[]>;
  for (const name of STORE_NAMES) stores[name] = await db.readAll(name);
  return { format: 'skierg-backup', version: 1, dbVersion: db.dbVersion, exportedAt: now.toISOString(), stores };
}

/** Validates unknown JSON as a backup file. Throws with a readable message. */
export function parseBackup(json: unknown): BackupFile {
  const f = json as Partial<BackupFile> | null;
  if (!f || f.format !== 'skierg-backup') throw new Error('Filen är ingen backup från SkiErg Training.');
  if (f.version !== 1) throw new Error(`Backupversion ${String(f.version)} stöds inte.`);
  const stores = f.stores as Partial<Record<StoreName, unknown>> | undefined;
  const present = (n: StoreName) => Array.isArray(stores?.[n]) || (LATER_STORES.includes(n) && stores?.[n] === undefined);
  if (!stores || !STORE_NAMES.every(present)) throw new Error('Backupen saknar data.');
  const filled = Object.fromEntries(STORE_NAMES.map((n) => [n, (stores[n] as unknown[] | undefined) ?? []])) as Record<StoreName, unknown[]>;
  return { ...(f as BackupFile), stores: filled };
}

/** Writes every record from the backup. Existing records with the same key are replaced. Returns counts. */
export async function importBackup(db: BackupTarget, file: BackupFile): Promise<Record<StoreName, number>> {
  if (file.dbVersion > db.dbVersion) throw new Error('Backupen kommer från en nyare version av appen.');
  const counts = {} as Record<StoreName, number>;
  for (const name of STORE_NAMES) {
    await db.writeAll(name, file.stores[name]);
    counts[name] = file.stores[name].length;
  }
  return counts;
}
