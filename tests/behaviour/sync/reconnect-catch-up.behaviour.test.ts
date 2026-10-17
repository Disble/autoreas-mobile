import type { SQLiteDatabase } from 'expo-sqlite';
import * as coverSweep from '../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import { SNAPSHOT_HEAL_STALE_AFTER_MS } from '../../../src/features/sync/snapshot-heal.constants';
import { resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { useActiveSeasonStore } from '../../../src/infrastructure/store/active-season-store';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { openPairedDatabase, readAnime } from './unresolved-fixtures.helpers';
import { ACTIVE_SEASON_ANSWER } from './unresolved-fixtures.constants';

// Same seam as `single-exit.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

// Fire-and-forget image work, not an outbound kind: stubbed so the response queue is about the sends.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue(undefined),
}));

/** The cursor the paired database starts from, so a pull "since the cursor" is visible. */
const STORED_CURSOR = 41;

/** A reconcile answer that confirms nothing, pulls nothing and keeps the cursor. */
const EMPTY_RECONCILE = {
  status: 202,
  body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: STORED_CURSOR },
};

/** The bridge's full anime list: empty, which is still a successful heal. */
const EMPTY_SNAPSHOT = { status: 200, body: [] };

/** The fixed time the first trigger happens at. */
const START_AT = 1_800_000_000_000;

/** Opens a paired database with no queued edit, the cursor at `STORED_CURSOR` and repaired status columns. */
async function openRepairedDatabase(): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [] });
  await runMigrations(adapter);
  await adapter.runAsync('UPDATE bridge_config SET last_changelog_id = ? WHERE id = 1', STORED_CURSOR);

  return adapter;
}

/** Stages one remote rename of `anime-1`, changed at `changedAt`, the way the native cycle does. */
async function stageRemoteRename(adapter: SQLiteDatabase, name: string, changedAt: number): Promise<void> {
  const snapshot = { _id: 'anime-1', nombre: name, estado: 0, nrocapvisto: 4, dias: [], generos: [], activo: 1, primeravez: 1 };
  await adapter.runAsync(
    "INSERT INTO pending_remote_changes (record_id, change_type, changed_fields, snapshot, timestamp, created_at) VALUES ('anime-1', 'update', ?, ?, ?, ?)",
    JSON.stringify(['nombre']),
    JSON.stringify(snapshot),
    changedAt,
    changedAt,
  );
}

/** Counts the remote changes still staged. */
async function countStaged(adapter: SQLiteDatabase): Promise<number | undefined> {
  const row = await adapter.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_remote_changes');

  return row?.count;
}

/** The request paths the fake bridge saw, without host, in arrival order. */
function sentPaths(fakeBridge: FakeBridge): string[] {
  return fakeBridge.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
}

/** Waits, on real timers, until the fake bridge has seen `count` requests. */
async function waitForRequests(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('reconnect catch-up (ADR 009 R-7)', () => {
  let fakeBridge: FakeBridge;
  let now: number;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    resetSyncConnectionStore();
    resetSyncFlush();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    now = START_AT;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    (coverSweep.runCoverSweep as jest.Mock).mockClear();
    // What the mounted foreground runtime does.
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
  });

  afterEach(() => {
    resetSyncFlush();
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('heals the full snapshot on mount, then sweeps covers after the heal', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    let requestsSeenBySweep = -1;
    (coverSweep.runCoverSweep as jest.Mock).mockImplementationOnce(async () => {
      requestsSeenBySweep = fakeBridge.requests.length;
    });

    await requestFlush(adapter, 'bootstrap');

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
    expect(coverSweep.runCoverSweep).toHaveBeenCalledTimes(1);
    expect(coverSweep.runCoverSweep).toHaveBeenCalledWith(adapter, undefined, { force: false });
    expect(requestsSeenBySweep).toBe(2);
  });

  it('heals the full snapshot on resume, however recent the last heal was', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);

    await requestFlush(adapter, 'bootstrap');
    now += 1_000;
    await requestFlush(adapter, 'app_active');

    // A resume also refreshes the active season (L28): a rating the native engine delivered in
    // the background shows only once the snapshot is read again.
    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'GET /api/animes',
      'POST /api/sync/reconcile',
      'GET /api/seasons/active',
      'GET /api/animes',
    ]);
  });

  it('pulls since the cursor and drains staged changes on every reconnect, without repeating a recent heal', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');

    for (const name of ['First Rename', 'Second Rename']) {
      now += 1_000;
      await stageRemoteRename(adapter, name, now);
      fakeBridge.queueResponse(EMPTY_RECONCILE);

      await requestFlush(adapter, 'ws_reconnected');

      expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: name }));
      expect(await countStaged(adapter)).toBe(0);
    }

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'GET /api/animes',
      'POST /api/sync/reconcile',
      'POST /api/sync/reconcile',
    ]);
    expect(fakeBridge.requests[3].body).toEqual(expect.objectContaining({ last_changelog_id: STORED_CURSOR }));
  });

  it('runs the full snapshot on a reconnect only once the last successful heal is more than 5 min old', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');

    now = START_AT + SNAPSHOT_HEAL_STALE_AFTER_MS;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    await requestFlush(adapter, 'ws_reconnected');

    now += 1;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'GET /api/animes',
      'POST /api/sync/reconcile',
      'POST /api/sync/reconcile',
      'GET /api/animes',
    ]);
  });

  it('does not let a failed heal reset the interval: the next reconnect heals again', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 500, body: null });
    await expect(requestFlush(adapter, 'bootstrap')).resolves.toBe(0);

    now += 1_000;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'GET /api/animes',
      'POST /api/sync/reconcile',
      'GET /api/animes',
    ]);
  });

  it('runs one cycle plus at most one follow-up for a concurrent reconnect and resume', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');
    now += 1_000;
    const held = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);

    const reconnect = requestFlush(adapter, 'ws_reconnected');
    const resume = requestFlush(adapter, 'app_active');
    const secondReconnect = requestFlush(adapter, 'ws_reconnected');
    await waitForRequests(fakeBridge, 3);

    expect(fakeBridge.requests).toHaveLength(3);
    expect(secondReconnect).toBe(resume);

    held.release(EMPTY_RECONCILE);
    await reconnect;
    await resume;
    await waitForSyncFlushIdle(adapter);

    // The reconnect pulled alone (its heal was recent); the follow-up serves the resume's season
    // refresh and heal.
    expect(sentPaths(fakeBridge).slice(2)).toEqual([
      'POST /api/sync/reconcile',
      'POST /api/sync/reconcile',
      'GET /api/seasons/active',
      'GET /api/animes',
    ]);
  });

  it('still never heals on a trigger that demands no heal', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);

    await requestFlush(adapter, 'local_mutation');

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile']);
    expect(coverSweep.runCoverSweep).not.toHaveBeenCalled();
  });
});
