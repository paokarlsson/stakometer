import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, parseBackup, STORE_NAMES, type BackupTarget, type StoreName } from '../src/storage/backup';
import { DEFAULT_SETTINGS, settingsFromRecords, settingsToRecords, validateSettings } from '../src/storage/settings';

/** In-memory database keyed like the real stores. */
class MemoryDb implements BackupTarget {
  readonly dbVersion = 1;
  readonly stores = new Map<StoreName, Map<string, unknown>>(STORE_NAMES.map((n) => [n, new Map()]));
  private key(store: StoreName, r: Record<string, unknown>): string {
    if (store === 'chunks') return `${r.sessionId}/${r.seq}`;
    return String(store === 'settings' ? r.key : r.id);
  }
  async readAll(store: StoreName) {
    return [...this.stores.get(store)!.values()].map((v) => structuredClone(v));
  }
  async writeAll(store: StoreName, records: readonly unknown[]) {
    for (const r of records) this.stores.get(store)!.set(this.key(store, r as Record<string, unknown>), structuredClone(r));
  }
}

describe('backup (§11)', () => {
  it('export followed by import into an empty database restores everything', async () => {
    const source = new MemoryDb();
    await source.writeAll('sessions', [{ id: 'a', startedAt: '2026-09-01' }, { id: 'b', startedAt: '2026-09-02' }]);
    await source.writeAll('chunks', [{ sessionId: 'a', seq: 0, strokes: [{ t: 1, power: 200 }], status: [] }, { sessionId: 'a', seq: 1, strokes: [], status: [] }]);
    await source.writeAll('signatures', [{ id: 'sig', cp: 200 }]);
    await source.writeAll('testResults', [{ id: 'r', duration: 30 }]);
    await source.writeAll('settings', settingsToRecords(DEFAULT_SETTINGS));

    const json = JSON.parse(JSON.stringify(await exportBackup(source, new Date('2026-09-24T12:00:00Z'))));
    const target = new MemoryDb();
    const counts = await importBackup(target, parseBackup(json));

    expect(counts).toEqual({ sessions: 2, chunks: 2, signatures: 1, testResults: 1, settings: settingsToRecords(DEFAULT_SETTINGS).length });
    for (const name of STORE_NAMES) expect(await target.readAll(name)).toEqual(await source.readAll(name));
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup({ format: 'skierg-rawlog' })).toThrow(/ingen backup/);
    expect(() => parseBackup({ format: 'skierg-backup', version: 2 })).toThrow(/version/);
    expect(() => parseBackup({ format: 'skierg-backup', version: 1, stores: { sessions: [] } })).toThrow(/saknar data/);
  });
});

describe('settings (§8.5)', () => {
  it('round-trips through key–value records and falls back to defaults', () => {
    const custom = { ...DEFAULT_SETTINGS, tolerance: 0.08, machine: 'skierg' as const, zones: { green: 0.7, yellow: 0.5, orange: 0.25 } };
    expect(settingsFromRecords(settingsToRecords(custom))).toEqual(custom);
    expect(settingsFromRecords([])).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromRecords([{ key: 'tolerance', value: 7 }])).toEqual(DEFAULT_SETTINGS);
  });

  it('validates', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, zones: { green: 0.4, yellow: 0.6, orange: 0.3 } })).toMatch(/Zongränserna/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, powerAvgStrokes: 0 })).toMatch(/drag/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, skiba: { a: 546, b: -1, c: 316 } })).toMatch(/Skiba/);
  });
});
