import type { SQLiteDatabase } from 'expo-sqlite';
import { enqueueSeasonRatingIntent } from '../../../src/features/sync/season-rating-intent.helpers';
import { writeCachedActiveSeasonSnapshot } from '../../../src/features/sync/season-sync.helpers';
import { resolveSyncFacadeConnectionStatus } from '../../../src/features/sync/bridge-reachability.helpers';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { getSyncConnectionSnapshot, resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import { deriveVisibleSyncStatus } from '../../../src/features/sync/sync-visible-status.helpers';
import { useActiveSeasonStore } from '../../../src/infrastructure/store/active-season-store';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { openPairedDatabase, readRatingRows } from './unresolved-fixtures.helpers';

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue(undefined),
}));

/** An empty reconcile answer: the bridge was reached and had nothing to say. */
const EMPTY_RECONCILE = {
  status: 202,
  body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: 0 },
};

/** The bridge's active-season answer naming `anime-1` as the only candidate. */
const ACTIVE_SEASON_ANSWER = {
  status: 200,
  body: { season_id: 'season-2', candidates: [{ anime_id: 'anime-1', grade: null, grade_source: null }] },
};

/** Opens the paired fixture database with the repaired `sync_runtime_status` columns. */
async function openRepairedDatabase(): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [] });
  await runMigrations(adapter);

  return adapter;
}

/** Reads the cached active season id, or `null` when nothing is cached. */
function readCachedSeason(adapter: SQLiteDatabase) {
  return adapter.getFirstAsync<{ season_id: string }>('SELECT season_id FROM active_season_cache WHERE id = 1');
}

/** Derives the visible status exactly as the facade feeds it: store snapshot plus the shared status row. */
async function readVisibleStatus(adapter: SQLiteDatabase, pendingOpsCount: number) {
  const row = await adapter.getFirstAsync<{ last_attempt_at: number | null; last_success_at: number | null }>(
    'SELECT last_attempt_at, last_success_at FROM sync_runtime_status WHERE id = 1',
  );
  const snapshot = getSyncConnectionSnapshot();

  return deriveVisibleSyncStatus(
    {
      connectionStatus: resolveSyncFacadeConnectionStatus(
        snapshot,
        row ? { lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at } : null,
      ),
      isBridgeConfigured: true,
      isDeviceOnline: true,
      lastSyncAt: snapshot.lastSyncAt,
      pendingOpsCount,
    },
    new Date(),
  );
}

describe('status tells the truth (ADR 009 R-9, S11)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    resetSyncConnectionStore();
    resetSyncFlush();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
  });

  afterEach(() => {
    resetSyncFlush();
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('does not wait "for the PC" after a cycle the bridge answered left a rating to retry', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 503, body: { error: 'busy' } });

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1 });
    await waitForSyncFlushIdle(adapter);

    expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect(getSyncConnectionSnapshot().kind).toBe('idle');
    expect(await readVisibleStatus(adapter, 1)).toMatchObject({ chipLabel: 'Por enviar', title: 'Bridge conectado' });
  });

  it('still waits for the bridge when the cycle could not reach it', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    // Nothing queued: the fake bridge rejects the request, which the client reports as unreachable.
    await expect(requestFlush(adapter, 'manual')).rejects.toThrow();

    expect(getSyncConnectionSnapshot().kind).toBe('unreachable');
    expect(await readVisibleStatus(adapter, 1)).toMatchObject({ chipLabel: 'Esperando a la PC', title: 'Esperando a la PC' });
  });

  it('stops claiming a reachable bridge once a WebSocket drop finds it gone (A1)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse(EMPTY_RECONCILE);
    fakeBridge.queueResponse({ status: 503, body: { error: 'busy' } });
    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1 });
    await waitForSyncFlushIdle(adapter);
    expect(await readVisibleStatus(adapter, 1)).toMatchObject({ title: 'Bridge conectado' });

    // The PC is turned off: the socket drops, and the flush it requests cannot reach the bridge.
    await expect(requestFlush(adapter, 'ws_disconnected')).rejects.toThrow();

    expect(getSyncConnectionSnapshot()).toMatchObject({ kind: 'unreachable', bridgeContact: { reached: false } });
    expect(await readVisibleStatus(adapter, 1)).toMatchObject({ chipLabel: 'Esperando a la PC', title: 'Esperando a la PC' });
    expect(fakeBridge.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/sync/reconcile',
      '/api/seasons/active/ratings',
      '/api/sync/reconcile',
    ]);
  });

  describe('I6: the season refresh after a delivered rating keeps active_season_cache in step', () => {
    it('writes the refreshed season into the cache', async () => {
      const adapter = await openRepairedDatabase();
      fakeBridge.queueResponse(EMPTY_RECONCILE);
      fakeBridge.queueResponse({ status: 204, body: null });
      fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);

      await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1 });
      await waitForSyncFlushIdle(adapter);

      expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'synced' })]);
      expect(useActiveSeasonStore.getState().activeSeasonSnapshot?.seasonId).toBe('season-2');
      expect(await readCachedSeason(adapter)).toEqual({ season_id: 'season-2' });
    });

    it('keeps the cached season when the refresh after the rating fails', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const adapter = await openRepairedDatabase();
      await writeCachedActiveSeasonSnapshot(adapter, { seasonId: 'season-1', candidates: [], candidatesByAnimeId: {} });
      fakeBridge.queueResponse(EMPTY_RECONCILE);
      fakeBridge.queueResponse({ status: 204, body: null });
      fakeBridge.queueResponse({ status: 500, body: { error: 'season store unavailable' } });

      await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1 });
      await waitForSyncFlushIdle(adapter);

      expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ status: 'synced' })]);
      expect(await readCachedSeason(adapter)).toEqual({ season_id: 'season-1' });
      expect(getSyncConnectionSnapshot().kind).toBe('online');
    });
  });
});
