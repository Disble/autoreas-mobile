import type { SQLiteDatabase } from 'expo-sqlite';
import { applyAnimeMutationPatch, buildCapPlusPatch } from '../../../src/features/animes/anime-mutation.helpers';
import { enqueueSeasonRatingIntent } from '../../../src/features/sync/season-rating-intent.helpers';
import { runMigrations } from '../../../src/infrastructure/db/client';
import { getSyncConnectionSnapshot, resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import { useActiveSeasonStore } from '../../../src/infrastructure/store/active-season-store';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { confirmedAt, openPairedDatabase, readOperationRows, readRatingRows } from './unresolved-fixtures.helpers';

// Same seam as `unresolved-keys.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

// The cover sweep is fire-and-forget image work after a `ws_sync_required` cycle, not an outbound
// kind; stubbing it keeps the fake bridge's response queue about the sends under test.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue(undefined),
}));

/** The bridge's active-season answer naming `anime-1` as the only candidate. */
const ACTIVE_SEASON_ANSWER = {
  status: 200,
  body: { season_id: 'season-2', candidates: [{ anime_id: 'anime-1', grade: null, grade_source: null }] },
};

/**
 * Opens the paired database of `unresolved-fixtures` with no queued edit. `runMigrations` adds the
 * `sync_runtime_status` columns that exist only as repairs, which the cycle's status writes reach.
 */
async function openRepairedDatabase(): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [] });
  await runMigrations(adapter);

  return adapter;
}

/** The persisted status columns a coordinated cycle writes. */
interface StoredRuntimeStatus {
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_cycle_stage: string | null;
}

/** Reads the singleton runtime-status row the cycle's recorders write. */
function readRuntimeStatus(adapter: SQLiteDatabase): Promise<StoredRuntimeStatus | null> {
  return adapter.getFirstAsync<StoredRuntimeStatus>(
    'SELECT last_attempt_at, last_success_at, last_cycle_stage FROM sync_runtime_status WHERE id = 1',
  );
}

/** The request urls the fake bridge saw, without host, in arrival order. */
function sentPaths(fakeBridge: FakeBridge): string[] {
  return fakeBridge.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
}

describe('one JS exit: callers enqueue and request a flush, only the dispatcher sends (ADR 009 R-2)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    resetSyncConnectionStore();
    resetSyncFlush();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    // What the mounted foreground runtime does.
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);
  });

  afterEach(() => {
    resetSyncFlush();
    fakeBridge.restore();
  });

  it('POSTs a season rating rated while online without any manual refresh (I1)', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse({ status: 202, body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: 0 } });
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1_700_000_000_000 });
    await waitForSyncFlushIdle(adapter);

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'POST /api/seasons/active/ratings',
      'GET /api/seasons/active',
    ]);
    expect(await readRatingRows(adapter)).toEqual([expect.objectContaining({ anime_id: 'anime-1', status: 'synced' })]);
  });

  it('runs an episode edit through the coordinated cycle: drains ratings, records the attempt and reaches online (I2)', async () => {
    const adapter = await openRepairedDatabase();
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-2', 'season_rating', '{\"seasonId\":\"season-1\",\"grade\":7,\"ratedAt\":1}', 'pending', 1)",
    );
    fakeBridge.queueResponse(confirmedAt(8));
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);

    await expect(applyAnimeMutationPatch(adapter, 'anime-1', buildCapPlusPatch, 'capPlus')).resolves.toBe(true);
    await waitForSyncFlushIdle(adapter);

    expect(sentPaths(fakeBridge)).toEqual([
      'POST /api/sync/reconcile',
      'POST /api/seasons/active/ratings',
      'GET /api/seasons/active',
    ]);
    expect(await readOperationRows(adapter)).toEqual([
      expect.objectContaining({ status: 'synced' }),
      expect.objectContaining({ status: 'synced' }),
    ]);
    expect(await readRuntimeStatus(adapter)).toEqual({
      last_attempt_at: expect.any(Number),
      last_success_at: expect.any(Number),
      last_cycle_stage: 'closed',
    });
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('refreshes and caches the active season when the WebSocket reports a season change (I8)', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse({ status: 202, body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: 0 } });
    fakeBridge.queueResponse(ACTIVE_SEASON_ANSWER);

    await requestFlush(adapter, 'ws_season_changed');

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile', 'GET /api/seasons/active']);
    expect(useActiveSeasonStore.getState().activeSeasonSnapshot?.seasonId).toBe('season-2');
    // The WebSocket path cached what it fetched before it went through the entry point; it still does.
    expect(
      await adapter.getFirstAsync<{ season_id: string }>('SELECT season_id FROM active_season_cache WHERE id = 1'),
    ).toEqual({ season_id: 'season-2' });
  });

  it('still leaves the active season alone on a plain trigger with nothing rated', async () => {
    const adapter = await openRepairedDatabase();
    fakeBridge.queueResponse({ status: 202, body: { status: 'ok', applied_operations: [], bridge_changes: [], last_changelog_id: 0 } });

    // `manual`, not `app_active`: a resume also heals the snapshot (ADR 009 R-7).
    await requestFlush(adapter, 'manual');

    expect(sentPaths(fakeBridge)).toEqual(['POST /api/sync/reconcile']);
    expect(getSyncConnectionSnapshot().kind).toBe('online');
  });

  it('keeps the rating and resolves the enqueue when the flush it kicked fails', async () => {
    const adapter = await openRepairedDatabase();
    registerSyncFlushDispatcher(() => Promise.reject(new Error('bridge unreachable')));

    await expect(
      enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1_700_000_000_000 }),
    ).resolves.toBeUndefined();
    await waitForSyncFlushIdle(adapter);

    expect(await readRatingRows(adapter)).toEqual([
      expect.objectContaining({ anime_id: 'anime-1', status: 'pending' }),
    ]);
  });

  it('sends nothing while no dispatcher is registered: JS has no background responsibility', async () => {
    resetSyncFlush();
    const adapter = await openRepairedDatabase();

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 8, ratedAt: 1_700_000_000_000 });
    await waitForSyncFlushIdle(adapter);

    expect(fakeBridge.requests).toEqual([]);
    expect(await readRatingRows(adapter)).toEqual([
      expect.objectContaining({ anime_id: 'anime-1', status: 'pending' }),
    ]);
  });
});
