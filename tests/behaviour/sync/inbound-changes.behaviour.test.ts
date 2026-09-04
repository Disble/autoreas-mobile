import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { applyRemoteChanges } from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import type { MergeContext, RemoteAnimeChange } from '../../../src/features/sync/merge/merge.types';
import * as schema from '../../../src/infrastructure/db/schema';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';
import { createSqliteProxyCallback } from '../../support/drizzle-test-factory.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

/** One `animes` row as read back from the real database. */
interface StoredAnimeRow {
  _id: string;
  nombre: string;
  nrocapvisto: number;
}

/** Builds a merge context with no staleness guards and no pending outbox operations. */
function emptyMergeContext(): MergeContext {
  return {
    guardByRecordId: new Map<string, number | null>(),
    pendingOutboxRecordIds: new Set<string>(),
  };
}

/** Builds a schema-valid remote snapshot for one anime. */
function remoteSnapshot(overrides: Partial<Anime> = {}): Anime {
  return {
    _id: 'anime-remote',
    nombre: 'Remote Anime',
    estado: 1,
    nrocapvisto: 3,
    dias: [],
    generos: [],
    activo: 1,
    primeravez: 1,
    ...overrides,
  } as Anime;
}

/** Opens a migrated database and the drizzle handle the merge boundary writes through. */
async function openDatabase() {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  const db = drizzle(createSqliteProxyCallback(adapter), { schema });

  return { adapter, db };
}

describe('inbound remote changes land in the database', () => {
  it('applies a create for a record the device has never seen', async () => {
    const { adapter, db } = await openDatabase();
    const change: RemoteAnimeChange = {
      recordId: 'anime-remote',
      changeType: 'create',
      changedFields: [],
      snapshot: remoteSnapshot(),
      timestamp: 1_700_000_000_000,
    };

    const result = await applyRemoteChanges(db as never, [change], emptyMergeContext());

    const rows = await adapter.getAllAsync<StoredAnimeRow>(
      'SELECT _id, nombre, nrocapvisto FROM animes',
    );
    expect(result.applied).toBe(1);
    expect(rows).toEqual([{ _id: 'anime-remote', nombre: 'Remote Anime', nrocapvisto: 3 }]);
  });

  it('applies an update to a record that already exists locally', async () => {
    const { adapter, db } = await openDatabase();
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
      'anime-remote',
      'Local Name',
      0,
      1,
      1,
      1,
    );
    const change: RemoteAnimeChange = {
      recordId: 'anime-remote',
      changeType: 'update',
      changedFields: ['nrocapvisto'],
      snapshot: remoteSnapshot({ nrocapvisto: 9 }),
      timestamp: 1_700_000_000_000,
    };

    const result = await applyRemoteChanges(db as never, [change], emptyMergeContext());

    const stored = await adapter.getFirstAsync<StoredAnimeRow>(
      'SELECT _id, nombre, nrocapvisto FROM animes WHERE _id = ?',
      'anime-remote',
    );
    expect(result.applied).toBe(1);
    expect(stored?.nrocapvisto).toBe(9);
    // Only the named field moves; the local name is untouched by a partial update.
    expect(stored?.nombre).toBe('Local Name');
  });

  it('A10 FIXED: an update with changed_fields for an unknown _id is upserted, not dropped', async () => {
    // This assertion was the executable characterization of defect A10, and its inversion here
    // is the proof the fix landed. Before the fix the record was absent AND `applied` was 1 --
    // the diagnostic counter reporting success for a write that never happened.
    //
    // The bridge emits change_type "update" for records created on the PC while the phone was
    // offline, so this is the ordinary path for anything created elsewhere, not an edge case.
    const { adapter, db } = await openDatabase();
    const change: RemoteAnimeChange = {
      recordId: 'anime-never-seen',
      changeType: 'update',
      changedFields: ['nrocapvisto'],
      snapshot: remoteSnapshot({ _id: 'anime-never-seen', nrocapvisto: 7 }),
      timestamp: 1_700_000_000_000,
    };

    const result = await applyRemoteChanges(db as never, [change], emptyMergeContext());

    const stored = await adapter.getFirstAsync<StoredAnimeRow>(
      'SELECT _id, nombre, nrocapvisto FROM animes WHERE _id = ?',
      'anime-never-seen',
    );
    expect(stored).not.toBeNull();
    expect(stored?.nrocapvisto).toBe(7);
    expect(result.applied).toBe(1);
  });

  it('upserts an update for an unknown _id when changed_fields is empty', async () => {
    // The same input shape as the A10 case above, differing only in an empty changed_fields --
    // which is the single condition that reaches the existence check. Kept adjacent to the
    // characterization so the asymmetry is visible in one file.
    const { adapter, db } = await openDatabase();
    const change: RemoteAnimeChange = {
      recordId: 'anime-never-seen',
      changeType: 'update',
      changedFields: [],
      snapshot: remoteSnapshot({ _id: 'anime-never-seen', nrocapvisto: 7 }),
      timestamp: 1_700_000_000_000,
    };

    const result = await applyRemoteChanges(db as never, [change], emptyMergeContext());

    const stored = await adapter.getFirstAsync<StoredAnimeRow>(
      'SELECT _id, nombre, nrocapvisto FROM animes WHERE _id = ?',
      'anime-never-seen',
    );
    expect(result.applied).toBe(1);
    expect(stored?.nrocapvisto).toBe(7);
  });

  it('deletes a record when the bridge sends a delete', async () => {
    const { adapter, db } = await openDatabase();
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
      'anime-remote',
      'Doomed',
      0,
      1,
      1,
      1,
    );
    const change: RemoteAnimeChange = {
      recordId: 'anime-remote',
      changeType: 'delete',
      changedFields: [],
      timestamp: 1_700_000_000_000,
    };

    const result = await applyRemoteChanges(db as never, [change], emptyMergeContext());

    const rows = await adapter.getAllAsync<StoredAnimeRow>('SELECT _id FROM animes');
    expect(result.applied).toBe(1);
    expect(rows).toEqual([]);
  });
});
