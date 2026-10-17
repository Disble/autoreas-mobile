import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { drainPendingRemoteChanges } from '../../../src/features/sync/remote-change-drain.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import {
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';

// Same seam as `fetch-first.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** The fields of `anime-1` these tests read back. */
interface StoredAnime {
  nombre: string;
  nrocapvisto: number;
  last_applied_change_ms: number | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  last_changelog_id?: number;
}

/** The wire fields a remote change may override on `anime-1`. */
interface RemoteFields {
  readonly name?: string;
  readonly episodesWatched?: number;
}

/** When the PC renamed `anime-1` and set it to episode 9. */
const REMOTE_CHANGE_AT = 1_700_000_100_000;

/**
 * Opens a paired database holding `anime-1` (episode 5, with a token) and, unless told
 * otherwise, the local edit that set episode 5, still queued.
 */
async function openDatabase({ withPendingEdit = true } = {}): Promise<SQLiteDatabase> {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    0,
  );
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Test Anime',
    0,
    5,
    1,
    1,
    7,
  );
  if (withPendingEdit) {
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', ?, 'pending', ?)",
      JSON.stringify({ episodesWatched: 5 }),
      1_700_000_000_000,
    );
  }

  return adapter;
}

/** One `bridge_changes` update of `anime-1`, naming the given fields as changed. */
function remoteUpdate(fields: RemoteFields, timestamp: number) {
  return {
    record_id: 'anime-1',
    change_type: 'update',
    changed_fields: Object.keys(fields),
    snapshot: {
      id: 'anime-1',
      name: fields.name ?? 'Test Anime',
      status: 0,
      episodesWatched: fields.episodesWatched ?? 5,
      active: 1,
      firstCycle: 1,
      lastWatchedAt: null,
      premieredAt: null,
      createdAt: null,
      deletedAt: null,
      // The bridge hardcodes this to 0 in `bridge_changes`; it is never a token.
      modified_at: 0,
    },
    timestamp,
  };
}

/** The PC's edit of `anime-1`: a new name and episode 9. */
const PC_EDIT = remoteUpdate({ name: 'Renamed on PC', episodesWatched: 9 }, REMOTE_CHANGE_AT);

/** A 202 carrying the given changes and cursor, with no applied operations unless given. */
function reconcileResponse(options: {
  appliedOperations?: ReturnType<typeof buildAppliedOperation>[];
  bridgeChanges?: unknown[];
  lastChangelogId: number;
}) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: options.appliedOperations ?? [],
      bridgeChanges: options.bridgeChanges as never,
      lastChangelogId: options.lastChangelogId,
    }),
  };
}

/** Reads `anime-1`, or `null` when it is gone. */
function readAnime(adapter: SQLiteDatabase) {
  return adapter.getFirstAsync<StoredAnime>(
    "SELECT nombre, nrocapvisto, last_applied_change_ms FROM animes WHERE _id = 'anime-1'",
  );
}

/** Reads the stored changelog cursor. */
async function readCursor(adapter: SQLiteDatabase) {
  const row = await adapter.getFirstAsync<{ last_changelog_id: number }>(
    'SELECT last_changelog_id FROM bridge_config WHERE id = 1',
  );

  return row?.last_changelog_id;
}

/** Counts the remote changes still staged. */
async function countStaged(adapter: SQLiteDatabase) {
  const row = await adapter.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM pending_remote_changes',
  );

  return row?.count;
}

/** Stages one remote change the way the native cycle does: a row in `pending_remote_changes`. */
async function stageRemoteChange(
  adapter: SQLiteDatabase,
  change: { changeType: string; changedFields: readonly string[]; snapshot: object | null; timestamp: number },
) {
  await adapter.runAsync(
    "INSERT INTO pending_remote_changes (record_id, change_type, changed_fields, snapshot, timestamp, created_at) VALUES ('anime-1', ?, ?, ?, ?, ?)",
    change.changeType,
    JSON.stringify(change.changedFields),
    change.snapshot === null ? null : JSON.stringify(change.snapshot),
    change.timestamp,
    change.timestamp,
  );
}

/** The local (domain-shape) snapshot the native cycle stages for `PC_EDIT`. */
const STAGED_PC_EDIT = {
  changeType: 'update',
  changedFields: ['nombre', 'nrocapvisto'],
  snapshot: {
    _id: 'anime-1',
    nombre: 'Renamed on PC',
    estado: 0,
    nrocapvisto: 9,
    dias: [],
    generos: [],
    activo: 1,
    primeravez: 1,
  },
  timestamp: REMOTE_CHANGE_AT,
};

/** The recorded reconcile requests, in order. */
function reconcileBodies(fakeBridge: FakeBridge): SentReconcileBody[] {
  return fakeBridge.requests
    .filter((request) => request.url.endsWith('/api/sync/reconcile'))
    .map((request) => request.body as SentReconcileBody);
}

describe('a remote change deferred behind a local edit is never lost (ADR 009 R-16a)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('applies it on the next cycle when the local edit was given up in the same round', async () => {
    const adapter = await openDatabase();
    fakeBridge.queueResponse(
      reconcileResponse({
        appliedOperations: [
          buildAppliedOperation({ anime_id: 'anime-1', applied: false, reason: 'unsupported_operation' }),
        ],
        bridgeChanges: [PC_EDIT],
        lastChangelogId: 5,
      }),
    );
    fakeBridge.queueResponse(reconcileResponse({ lastChangelogId: 5 }));

    await syncPendingOperations(adapter);

    // Deferred while the edit was in flight, and the cursor moved past it anyway.
    expect(await readCursor(adapter)).toBe(5);
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Test Anime', nrocapvisto: 5 }));

    await syncPendingOperations(adapter);

    // The second cycle pulled nothing new (cursor 5), yet the PC's edit landed.
    expect(reconcileBodies(fakeBridge)[1].last_changelog_id).toBe(5);
    expect(await readAnime(adapter)).toEqual({
      nombre: 'Renamed on PC',
      nrocapvisto: 9,
      last_applied_change_ms: REMOTE_CHANGE_AT,
    });
    expect(await countStaged(adapter)).toBe(0);
  });

  it('keeps the confirmed local edit and the PC fields it did not touch when the edit is confirmed in the same round', async () => {
    // The bridge applied the PC's edit first and this device's edit after it, so `bridge_changes`
    // holds both: the PC's edit and then the echo of the confirmed local edit. Both are deferred in
    // the round (the edit was still in flight) and re-applied in timestamp order by the next cycle:
    // the PC's name stays, and the echo, being newer, puts episode 5 back over the PC's 9.
    const adapter = await openDatabase();
    const echoAt = REMOTE_CHANGE_AT + 1_000;
    fakeBridge.queueResponse(
      reconcileResponse({
        appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', modified_at: 8 })],
        bridgeChanges: [PC_EDIT, remoteUpdate({ name: 'Renamed on PC', episodesWatched: 5 }, echoAt)],
        lastChangelogId: 6,
      }),
    );
    fakeBridge.queueResponse(reconcileResponse({ lastChangelogId: 6 }));

    await syncPendingOperations(adapter);

    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Test Anime', nrocapvisto: 5 }));

    await syncPendingOperations(adapter);

    expect(await readAnime(adapter)).toEqual({
      nombre: 'Renamed on PC',
      nrocapvisto: 5,
      last_applied_change_ms: echoAt,
    });
    expect(await countStaged(adapter)).toBe(0);
  });

  it('keeps a staged change the drain deferred and applies it on a later drain once the edit is gone', async () => {
    const adapter = await openDatabase();
    await stageRemoteChange(adapter, STAGED_PC_EDIT);

    await drainPendingRemoteChanges(adapter);

    expect(await countStaged(adapter)).toBe(1);
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Test Anime', nrocapvisto: 5 }));

    await adapter.runAsync("UPDATE operation_log SET status = 'synced' WHERE anime_id = 'anime-1'");
    await drainPendingRemoteChanges(adapter);

    expect(await readAnime(adapter)).toEqual({
      nombre: 'Renamed on PC',
      nrocapvisto: 9,
      last_applied_change_ms: REMOTE_CHANGE_AT,
    });
    expect(await countStaged(adapter)).toBe(0);
  });

  it('never keeps a deferred change that a later delete of the same anime supersedes', async () => {
    const adapter = await openDatabase();
    await stageRemoteChange(adapter, STAGED_PC_EDIT);
    await stageRemoteChange(adapter, {
      changeType: 'delete',
      changedFields: [],
      snapshot: null,
      timestamp: REMOTE_CHANGE_AT + 1_000,
    });

    await drainPendingRemoteChanges(adapter);
    await adapter.runAsync("UPDATE operation_log SET status = 'synced' WHERE anime_id = 'anime-1'");
    await drainPendingRemoteChanges(adapter);

    // Keeping the earlier edit would bring the deleted anime back as soon as the edit is gone.
    expect(await readAnime(adapter)).toBeNull();
    expect(await countStaged(adapter)).toBe(0);
  });

  it('applies a change in its own round, and stages nothing, when no local edit defers it', async () => {
    const adapter = await openDatabase({ withPendingEdit: false });
    fakeBridge.queueResponse(reconcileResponse({ bridgeChanges: [PC_EDIT], lastChangelogId: 5 }));

    await syncPendingOperations(adapter);

    expect(await readAnime(adapter)).toEqual({
      nombre: 'Renamed on PC',
      nrocapvisto: 9,
      last_applied_change_ms: REMOTE_CHANGE_AT,
    });
    expect(await readCursor(adapter)).toBe(5);
    expect(await countStaged(adapter)).toBe(0);
  });

  it('still applies and removes a staged change no local edit defers', async () => {
    const adapter = await openDatabase({ withPendingEdit: false });
    await stageRemoteChange(adapter, STAGED_PC_EDIT);

    const result = await drainPendingRemoteChanges(adapter);

    expect(result).toEqual({ applied: 1, dropped: 0, deferred: 0, rejected: 0 });
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Renamed on PC', nrocapvisto: 9 }));
    expect(await countStaged(adapter)).toBe(0);
  });
});
