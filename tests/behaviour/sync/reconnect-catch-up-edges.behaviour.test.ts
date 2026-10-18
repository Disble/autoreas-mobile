import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncConnectionSnapshot } from '../../../src/features/sync/sync-connection-store/sync-connection-store.helpers';
import * as coverSweep from '../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import { resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { openPairedDatabase, queueEdit, readAnime } from './unresolved-fixtures.helpers';

// Same seam as `reconnect-catch-up.behaviour.test.ts`: only the drizzle factory is swapped.
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
  hydrateCoverUris: jest.fn().mockResolvedValue(undefined),
}));

/** The cursor the paired database starts from. */
const STORED_CURSOR = 41;
/** One minute, in ms. */
const MINUTE = 60 * 1000;
/** A reconcile answer that confirms nothing, pulls nothing and keeps the cursor. */
const EMPTY_RECONCILE = {
  status: 202,
  body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: STORED_CURSOR },
};
/** The bridge's full anime list: empty, which is still a successful heal. */
const EMPTY_SNAPSHOT = { status: 200, body: [] };
/** The bridge holds `anime-1` under a name the device never saw: a heal must write it locally. */
const DRIFTED_SNAPSHOT = {
  status: 200,
  body: [
    {
      id: 'anime-1',
      name: 'Bridge Name',
      status: 0,
      episodesWatched: 4,
      active: 1,
      firstCycle: 1,
      lastWatchedAt: null,
      premieredAt: null,
      createdAt: null,
      deletedAt: null,
      modified_at: 9,
    },
  ],
};
/** The fixed time the first trigger happens at. */
const START_AT = 1_800_000_000_000;

/** Opens a paired database with no queued edit, the cursor at `STORED_CURSOR` and repaired status columns. */
async function openRepairedDatabase(): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [] });
  await runMigrations(adapter);
  await adapter.runAsync('UPDATE bridge_config SET last_changelog_id = ? WHERE id = 1', STORED_CURSOR);
  return adapter;
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

describe('reconnect catch-up edges (ADR 009 R-7, T12 verifier probes)', () => {
  let fakeBridge: FakeBridge;
  let now: number;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    resetSyncConnectionStore();
    resetSyncFlush();
    now = START_AT;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (coverSweep.runCoverSweep as jest.Mock).mockClear();
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
  });

  afterEach(() => {
    resetSyncFlush();
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('P1 reconnect at 4:59 after a successful heal only pulls; at 5:01 it heals', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');

    now = START_AT + 4 * MINUTE + 59_000;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    await requestFlush(adapter, 'ws_reconnected');
    expect(sentPaths(fakeBridge).slice(2)).toEqual(['POST /api/sync/reconcile']);
    expect(fakeBridge.requests[2].body).toEqual(expect.objectContaining({ last_changelog_id: STORED_CURSOR }));

    now = START_AT + 5 * MINUTE + 1_000;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');
    expect(sentPaths(fakeBridge).slice(3)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
  });

  it('P2 a failed heal at T does not reset the interval measured from the success at T-4min', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');

    now = START_AT + 4 * MINUTE;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 500, body: null });
    await requestFlush(adapter, 'app_active');

    // 6 min after the success, 2 min after the failure: stale from the success, so it heals.
    now = START_AT + 6 * MINUTE;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');

    expect(sentPaths(fakeBridge).slice(4)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
  });

  it('P2b success at T-6min, failure at T, reconnect at T+1min heals', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');
    now = START_AT + 6 * MINUTE;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 500, body: null });
    await requestFlush(adapter, 'app_active');
    now = START_AT + 7 * MINUTE;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');
    expect(sentPaths(fakeBridge).slice(4)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
  });

  it('P3 mount heals drifted data even when the reconcile answers 5xx (bridge reachable, GET works)', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse({ status: 503, body: null });
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);

    await requestFlush(adapter, 'bootstrap').catch(() => undefined);

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Bridge Name' }));
  });

  it('P3b resume heals drifted data even when the reconcile answers 5xx', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');
    now += MINUTE;
    fakeBridge.queueResponse({ status: 503, body: null });
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);

    await requestFlush(adapter, 'app_active').catch(() => undefined);

    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Bridge Name' }));
  });

  it('P3c a 4xx-rejected edit (T10 isolation) does not stop the mount heal', async () => {
    const adapter = await openRepairedDatabase();
    await queueEdit(adapter, 5, START_AT - 10);
    fakeBridge.queueResponse({ status: 422, body: { error: 'bad' } });
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);

    await expect(requestFlush(adapter, 'bootstrap')).rejects.toThrow('Reconcile failed: 422');

    expect(sentPaths(fakeBridge)).toContain('GET /api/animes');
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Bridge Name' }));
  });

  it('P4 burst during a running cycle: 1 running + 1 follow-up serving the strongest demand', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    await requestFlush(adapter, 'bootstrap');
    now += MINUTE;

    const held = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    const running = requestFlush(adapter, 'ws_reconnected');
    const a = requestFlush(adapter, 'ws_reconnected');
    const b = requestFlush(adapter, 'ws_reconnected');
    await waitForRequests(fakeBridge, 3);
    expect(a).toBe(b);
    held.release(EMPTY_RECONCILE);
    await running;
    await a;
    await waitForSyncFlushIdle(adapter);
    // Two reconnect runs within 5 min of a success: two pulls, no snapshot.
    expect(sentPaths(fakeBridge).slice(2)).toEqual(['POST /api/sync/reconcile', 'POST /api/sync/reconcile']);

    const held2 = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(EMPTY_SNAPSHOT);
    const running2 = requestFlush(adapter, 'ws_reconnected');
    const c = requestFlush(adapter, 'ws_reconnected');
    const d = requestFlush(adapter, 'app_active');
    await waitForRequests(fakeBridge, 5);
    expect(c).toBe(d);
    held2.release(EMPTY_RECONCILE);
    await running2;
    await d;
    await waitForSyncFlushIdle(adapter);
    expect(sentPaths(fakeBridge).slice(4)).toEqual([
      'POST /api/sync/reconcile',
      'POST /api/sync/reconcile',
      'GET /api/animes',
    ]);
    // bootstrap + 2 reconnect runs (persisted as ws_sync_required, a sweep source) + 2 more.
    expect(coverSweep.runCoverSweep).toHaveBeenCalledTimes(5);
  });

  it('P3e an edit whose send failed stays pending, so the heal after the failure skips its anime', async () => {
    const adapter = await openRepairedDatabase();
    await queueEdit(adapter, 5, START_AT - 10);
    fakeBridge.queueResponse({ status: 503, body: null });
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);

    await requestFlush(adapter, 'bootstrap').catch(() => undefined);

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Local Name' }));
    expect(
      await adapter.getAllAsync<{ status: string }>("SELECT status FROM operation_log WHERE anime_id = 'anime-1'"),
    ).toEqual([{ status: 'pending' }]);
  });

  it('P3d warns that the resync failed when the bridge is down at mount, as the independent heal did', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    // Nothing queued for the snapshot: the fake bridge fails that request like an unreachable host.
    fakeBridge.queueResponse({ status: 503, body: null });

    await requestFlush(adapter, 'bootstrap').catch(() => undefined);

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'GET /api/animes']);
    expect(warn).toHaveBeenCalledWith('[useForegroundResync] Resync failed', expect.anything());
  });

  it('D-healthy mount matches baseline: same requests (modulo order), drift healed, one sweep', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);
    await expect(requestFlush(adapter, 'bootstrap')).resolves.toBe(0);
    expect(sentPaths(fakeBridge).sort()).toEqual(['GET /api/animes', 'POST /api/sync/reconcile']);
    expect(await readAnime(adapter)).toEqual({ nombre: 'Bridge Name', nrocapvisto: 4, bridge_modified_at: 9 });
    expect(coverSweep.runCoverSweep).toHaveBeenCalledTimes(1);
    expect(getSyncConnectionSnapshot()).toEqual(expect.objectContaining({ kind: 'online', message: null }));
  });

  it('P5 cold start with no successful heal yet: a reconnect heals (absent timestamp is stale)', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse({ status: 503, body: null });
    await requestFlush(adapter, 'bootstrap').catch(() => undefined);
    now += MINUTE;
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse(DRIFTED_SNAPSHOT);
    await requestFlush(adapter, 'ws_reconnected');
    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Bridge Name' }));
  });
});
