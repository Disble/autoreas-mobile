import type { SQLiteDatabase } from 'expo-sqlite';
import {
  readUnresolvedKeyCount,
  resolveUnresolvedKey,
  UnresolvedResolutionError,
} from '../../../src/features/sync';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import {
  animeAnswer,
  confirmedAt,
  emptyReconcile,
  openPairedDatabase,
  rateAndSync,
  readAnime,
  readOperationRows,
  readRatingRows,
  sentOperations,
  sentRatings,
} from './unresolved-fixtures.helpers';

// Same seam as `outbox-chain.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** The outbox key of `anime-1`. */
const ANIME_KEY = { kind: 'anime', animeId: 'anime-1' } as const;

/** The rating key of `anime-1` in `season-1`. */
const RATING_KEY = { kind: 'season_rating', seasonId: 'season-1', animeId: 'anime-1' } as const;

/** Opens a database whose `anime-1` key holds a given-up row (id 1) and a pending row (id 2). */
async function openWithGivenUpRow(status = 'dead_letter', reason: string | null = null): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [5, 6] });
  await adapter.runAsync(
    'UPDATE operation_log SET status = ?, unresolved_reason = ?, conflict_attempt_count = 3 WHERE id = 1',
    status,
    reason,
  );

  return adapter;
}

/** Opens a database whose `anime-1` rating in `season-1` the bridge answered with `status`. */
async function openWithUnresolvedRating(fakeBridge: FakeBridge, status: number): Promise<SQLiteDatabase> {
  const adapter = await openPairedDatabase({ episodes: [] });
  await rateAndSync(adapter, fakeBridge, 'anime-1', status);

  return adapter;
}

/** Runs `resolve` and returns the code of the `UnresolvedResolutionError` it must reject with. */
async function refusalCode(resolve: Promise<void>): Promise<string> {
  const error = await resolve.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UnresolvedResolutionError);

  return (error as UnresolvedResolutionError).code;
}

describe('the single resolution entry point acts on the whole key (ADR 009 R-16b)', () => {
  let fakeBridge: FakeBridge;
  let info: jest.SpyInstance;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  describe('keep local', () => {
    it('re-queues the given-up rows and re-chains the key from a freshly fetched base', async () => {
      const adapter = await openWithGivenUpRow('conflict_exhausted');

      await resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_local');

      expect(await readUnresolvedKeyCount(adapter)).toBe(0);
      const requeued = await adapter.getAllAsync<{ status: string; conflict_attempt_count: number }>(
        'SELECT status, conflict_attempt_count FROM operation_log ORDER BY id',
      );
      expect(requeued).toEqual([
        { status: 'pending', conflict_attempt_count: 0 },
        { status: 'pending', conflict_attempt_count: 0 },
      ]);
      expect((await readAnime(adapter))?.bridge_modified_at).toBeNull();
      expect(info).toHaveBeenCalledWith('[unresolved] resolved by choice', {
        key: ANIME_KEY,
        choice: 'keep_local',
        rows: [{ id: 1, status: 'conflict_exhausted', unresolvedReason: null }],
      });

      fakeBridge.queueResponse(animeAnswer({ token: 40 }));
      fakeBridge.queueResponse(confirmedAt(41));
      fakeBridge.queueResponse(confirmedAt(42));
      await syncPendingOperations(adapter);

      expect(fakeBridge.requests[0].method).toBe('GET');
      expect(sentOperations(fakeBridge).map((operation) => operation.base)).toEqual([40, 41]);
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced']);
    });

    it('re-queues an unresolved 409 rating, and the next cycle sends it again', async () => {
      const adapter = await openWithUnresolvedRating(fakeBridge, 409);

      await resolveUnresolvedKey(adapter, RATING_KEY, 'keep_local');

      expect(await readRatingRows(adapter)).toEqual([
        { id: 1, anime_id: 'anime-1', status: 'pending', unresolved_reason: null },
      ]);
      // A rating carries no base: the anime's token is left as it was.
      expect((await readAnime(adapter))?.bridge_modified_at).toBe(7);
      fakeBridge.queueResponse(emptyReconcile());
      fakeBridge.queueResponse({ status: 204, body: null });
      await syncPendingOperations(adapter);
      expect(sentRatings(fakeBridge)).toHaveLength(2);
      expect(await readRatingRows(adapter)).toEqual([
        { id: 1, anime_id: 'anime-1', status: 'synced', unresolved_reason: null },
      ]);
    });

    it.each([
      ['bridge_404'],
      ['token_missing'],
    ])('is not offered for a %s key: rejected with a typed error, nothing written', async (reason) => {
      const adapter = await openWithGivenUpRow('dead_letter', reason);

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_local'))).toBe('choice_not_offered');
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter', 'pending']);
      expect((await readAnime(adapter))?.bridge_modified_at).toBe(7);
    });

    it('is not offered for a 404 rating', async () => {
      const adapter = await openWithUnresolvedRating(fakeBridge, 404);

      expect(await refusalCode(resolveUnresolvedKey(adapter, RATING_KEY, 'keep_local'))).toBe('choice_not_offered');
      expect((await readRatingRows(adapter))[0].status).toBe('dead_letter');
    });
  });

  describe('keep bridge', () => {
    it('drops every queued row of the key and applies the bridge state, token included', async () => {
      const adapter = await openWithGivenUpRow();
      fakeBridge.queueResponse(animeAnswer({ name: 'Bridge Name', episodesWatched: 9, token: 30 }));

      await resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge');

      expect(fakeBridge.requests[0].url).toMatch(/\/api\/animes\/anime-1$/);
      expect(await readOperationRows(adapter)).toEqual([]);
      expect(await readAnime(adapter)).toEqual({ nombre: 'Bridge Name', nrocapvisto: 9, bridge_modified_at: 30 });
      expect(info).toHaveBeenCalledWith('[unresolved] resolved by choice', expect.objectContaining({ choice: 'keep_bridge' }));
    });

    it('applies the delete rule when the bridge answers 404', async () => {
      const adapter = await openWithGivenUpRow('dead_letter', 'bridge_404');
      fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });

      await resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge');

      expect(await readAnime(adapter)).toBeNull();
      expect(await readOperationRows(adapter)).toEqual([]);
      expect(await readUnresolvedKeyCount(adapter)).toBe(0);
    });

    it('drops an unresolved rating, leaving the bridge rating to show', async () => {
      const adapter = await openWithUnresolvedRating(fakeBridge, 404);

      await resolveUnresolvedKey(adapter, RATING_KEY, 'keep_bridge');

      expect(await readRatingRows(adapter)).toEqual([]);
      // Keep bridge for a rating asks the bridge nothing: the season refresh shows its rating.
      expect(fakeBridge.requests).toHaveLength(2);
    });

    it('writes nothing when the bridge cannot be reached', async () => {
      const adapter = await openWithGivenUpRow();
      fakeBridge.queueResponse({ status: 503, body: { error: 'busy' } });

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge'))).toBe('bridge_unreachable');
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter', 'pending']);
    });

    it('writes nothing when the request to the bridge fails in transport', async () => {
      const adapter = await openWithGivenUpRow();
      const fetch = fakeBridge.queueDeferredResponse();

      const resolution = refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge'));
      for (let attempt = 0; attempt < 200 && fakeBridge.requests.length === 0; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      fetch.reject(new TypeError('Network request failed'));

      expect(await resolution).toBe('bridge_unreachable');
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter', 'pending']);
    });

    it('writes nothing when the bridge still returns the anime with no token', async () => {
      const adapter = await openWithGivenUpRow('dead_letter', 'token_missing');
      fakeBridge.queueResponse(animeAnswer());

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge'))).toBe('remote_state_unavailable');
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter', 'pending']);
    });

    it('writes nothing when no bridge is paired', async () => {
      const adapter = await openWithGivenUpRow();
      await adapter.runAsync('DELETE FROM bridge_config');

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, 'keep_bridge'))).toBe('not_paired');
      expect(fakeBridge.requests).toHaveLength(0);
    });
  });

  describe('refusals that hold for both choices', () => {
    it.each([['keep_local'], ['keep_bridge']] as const)('refuses %s for a key that is not unresolved', async (choice) => {
      const adapter = await openPairedDatabase();

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, choice))).toBe('not_unresolved');
      expect(await refusalCode(resolveUnresolvedKey(adapter, RATING_KEY, choice))).toBe('not_unresolved');
      expect(fakeBridge.requests).toHaveLength(0);
    });

    it.each([['keep_local'], ['keep_bridge']] as const)('refuses %s while the other runtime holds a live claim on the key (R-13)', async (choice) => {
      const adapter = await openWithGivenUpRow();
      await adapter.runAsync(
        "UPDATE operation_log SET status = 'processing', claim_owner = 'native', claimed_at = ? WHERE id = 2",
        Date.now(),
      );
      fakeBridge.queueResponse(animeAnswer({ token: 30 }));

      expect(await refusalCode(resolveUnresolvedKey(adapter, ANIME_KEY, choice))).toBe('key_claimed');
      expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter', 'processing']);
    });

    it('refuses a rating while its anime holds a live claim (R-13)', async () => {
      const adapter = await openWithUnresolvedRating(fakeBridge, 409);
      await adapter.runAsync(
        "INSERT INTO operation_log (anime_id, operation, payload, status, created_at, claim_owner, claimed_at) VALUES ('anime-1', 'update', '{}', 'processing', 1, 'native', ?)",
        Date.now(),
      );

      expect(await refusalCode(resolveUnresolvedKey(adapter, RATING_KEY, 'keep_local'))).toBe('key_claimed');
      expect(await refusalCode(resolveUnresolvedKey(adapter, RATING_KEY, 'keep_bridge'))).toBe('key_claimed');
      expect((await readRatingRows(adapter))[0].status).toBe('dead_letter');
    });

    it('lets a rating be resolved while only another anime holds a claim', async () => {
      const adapter = await openWithUnresolvedRating(fakeBridge, 409);
      await adapter.runAsync(
        "INSERT INTO operation_log (anime_id, operation, payload, status, created_at, claim_owner, claimed_at) VALUES ('anime-9', 'season_rating', '{\"seasonId\":\"season-1\"}', 'processing', 1, 'native', ?)",
        Date.now(),
      );

      await resolveUnresolvedKey(adapter, RATING_KEY, 'keep_bridge');

      expect((await readRatingRows(adapter)).map((row) => row.anime_id)).toEqual(['anime-9']);
    });
  });
});
