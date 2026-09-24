// Backup of the whole database as JSON (spec §11, §8.5).

export const STORE_NAMES = ['sessions', 'chunks', 'signatures', 'testResults', 'settings'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

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
  if (!f.stores || !STORE_NAMES.every((n) => Array.isArray(f.stores![n]))) throw new Error('Backupen saknar data.');
  return f as BackupFile;
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
