import type { SQLiteDatabase } from 'expo-sqlite';
import { listUnresolvedKeys } from '../../../src/features/sync';
import { runMigrations } from '../../../src/infrastructure/db/client';
import {
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
} from '../../../src/features/sync/season-rating-queue.helpers';
import { runCoordinatedForegroundSyncCycle } from '../../../src/features/sync/sync-facade.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
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

/** Queues one season rating of `animeId`. */
function rate(adapter: SQLiteDatabase, animeId: string) {
  return enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId, nota: 5, ratedAt: 1_700_000_000_000 });
}

/** The answer the rating endpoint gives for `status`. */
function ratingAnswer(status: number) {
  return { status, body: status === 204 ? null : { error: 'rejected' } };
}

/**
 * Runs one foreground cycle from a trigger that starts no cover sweep. `runMigrations` adds the
 * `sync_runtime_status` columns that exist only as repairs, which the cycle's status writes reach.
 */
async function runCycle(adapter: SQLiteDatabase) {
  await runMigrations(adapter);
  return runCoordinatedForegroundSyncCycle({
    rawDb: adapter,
    source: 'app_active',
    setActiveSeasonSnapshot: jest.fn(),
  });
}

describe('season-rating failure fates (ADR 009 R-5)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('never fails the cycle over a failing rating, and the anime outbox still sends (I4)', async () => {
    const adapter = await openPairedDatabase();
    await rate(adapter, 'anime-1');
    fakeBridge.queueResponse(confirmedAt(14));
    fakeBridge.queueResponse(ratingAnswer(500));

    await expect(runCycle(adapter)).resolves.toBe(1);

    expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['synced']);
    expect(await readRatingRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'pending', last_failure_kind: 'unexpected_response' },
    ]);
  });

  it('never fails the cycle over a rating whose local write fails, and still delivers the next rating', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rate(adapter, 'anime-1');
    await rate(adapter, 'anime-2');
    const runAsync = adapter.runAsync.bind(adapter);
    let failedOnce = false;
    jest.spyOn(adapter, 'runAsync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (!failedOnce && sql.startsWith('UPDATE season_rating_queue') && sql.includes('NOT EXISTS')) {
        failedOnce = true;
        return Promise.reject(new Error('disk I/O error'));
      }
      return (runAsync as (...args: unknown[]) => unknown)(sql, ...params);
    }) as typeof adapter.runAsync);
    fakeBridge.queueResponse({ status: 202, body: buildReconcileResponseBody({ lastChangelogId: 1 }) });
    fakeBridge.queueResponse(ratingAnswer(204));
    // The delivered rating refreshes the active season; the bridge has none.
    fakeBridge.queueResponse({ status: 404, body: { error: 'no active season' } });

    await expect(runCycle(adapter)).resolves.toBe(0);

    expect((await readRatingRows(adapter)).map((row) => row.anime_id)).toEqual(['anime-1']);
  });

  it('keeps delivering the next rating after one fails', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rate(adapter, 'anime-1');
    await rate(adapter, 'anime-2');
    fakeBridge.queueResponse(ratingAnswer(500));
    fakeBridge.queueResponse(ratingAnswer(204));

    await drainSeasonRatingQueue(adapter);

    expect((await readRatingRows(adapter)).map((row) => [row.anime_id, row.status])).toEqual([['anime-1', 'pending']]);
  });

  it.each([
    [401, 'auth_repair'],
    [403, 'rejected'],
    [422, 'rejected'],
  ])('keeps a rating the bridge answered %i as unresolved and never sends it again (I3)', async (status, kind) => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rate(adapter, 'anime-1');
    fakeBridge.queueResponse(ratingAnswer(status));

    await drainSeasonRatingQueue(adapter);
    await drainSeasonRatingQueue(adapter);

    expect(fakeBridge.requests).toHaveLength(1);
    expect(await readRatingRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'failed', last_failure_kind: kind },
    ]);
    expect(await listUnresolvedKeys(adapter)).toEqual([
      {
        kind: 'season_rating',
        seasonId: 'season-1',
        animeId: 'anime-1',
        rows: [{ id: 1, lastFailureKind: kind }],
        offeredChoices: ['keep_local', 'keep_bridge'],
      },
    ]);
  });

  it('still keeps a rating pending and retries it next drain after a 5xx', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rate(adapter, 'anime-1');
    fakeBridge.queueResponse(ratingAnswer(503));
    fakeBridge.queueResponse(ratingAnswer(204));

    await drainSeasonRatingQueue(adapter);
    await drainSeasonRatingQueue(adapter);

    expect(fakeBridge.requests).toHaveLength(2);
    expect(await readRatingRows(adapter)).toEqual([]);
  });
});
