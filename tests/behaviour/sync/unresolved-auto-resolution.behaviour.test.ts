import { readUnresolvedKeyCount } from '../../../src/features/sync';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
import {
  confirmedAt,
  openPairedDatabase,
  queueEdit,
  rateAndSync,
  readOperationRows,
  readRatingRows,
  reconcileAnswer,
} from './unresolved-fixtures.helpers';
import { FIRST_ROW_AT } from './unresolved-fixtures.constants';

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

describe('a later confirmed edit resolves an unresolved key automatically, and says why (L18)', () => {
  let fakeBridge: FakeBridge;
  let info: jest.SpyInstance;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('removes the given-up row in the transaction that confirms the later edit, and logs the reason', async () => {
    const adapter = await openPairedDatabase({ episodes: [5, 6] });
    fakeBridge.queueResponse(reconcileAnswer({ applied: false, reason: 'unsupported_operation' }));
    fakeBridge.queueResponse(confirmedAt(14));
    await syncPendingOperations(adapter);
    expect(await readUnresolvedKeyCount(adapter)).toBe(1);

    await syncPendingOperations(adapter);

    expect(await readOperationRows(adapter)).toEqual([expect.objectContaining({ id: 2, status: 'synced' })]);
    expect(await readUnresolvedKeyCount(adapter)).toBe(0);
    expect(info).toHaveBeenCalledWith('[unresolved] resolved automatically', {
      key: { kind: 'anime', animeId: 'anime-1' },
      reason: 'superseded by confirmed operation 2',
      rows: [{ id: 1, status: 'dead_letter', unresolvedReason: null }],
    });
  });

  it('resolves a conflict-exhausted row the same way', async () => {
    const adapter = await openPairedDatabase({ episodes: [5, 6] });
    await adapter.runAsync("UPDATE operation_log SET status = 'conflict_exhausted' WHERE id = 1");
    fakeBridge.queueResponse(confirmedAt(14));

    await syncPendingOperations(adapter);

    expect(await readOperationRows(adapter)).toEqual([expect.objectContaining({ id: 2, status: 'synced' })]);
    expect(info).toHaveBeenCalledWith('[unresolved] resolved automatically', expect.objectContaining({
      rows: [{ id: 1, status: 'conflict_exhausted', unresolvedReason: null }],
    }));
  });

  it('never resolves a given-up row queued after the confirmed one, nor one of another anime', async () => {
    const adapter = await openPairedDatabase({ episodes: [5, 6] });
    await adapter.runAsync("UPDATE operation_log SET status = 'dead_letter' WHERE id = 2");
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-2', 'update', '{}', 'dead_letter', ?)",
      FIRST_ROW_AT - 1,
    );
    fakeBridge.queueResponse(confirmedAt(14));

    await syncPendingOperations(adapter);

    expect((await readOperationRows(adapter)).map((row) => [row.id, row.status])).toEqual([
      [1, 'synced'],
      [2, 'dead_letter'],
      [3, 'dead_letter'],
    ]);
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps a 404 key unresolved: its later edit is fetched first and given up again, never confirmed', async () => {
    const adapter = await openPairedDatabase({ token: null });
    fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });
    fakeBridge.queueResponse({ status: 202, body: buildReconcileResponseBody({ lastChangelogId: 1 }) });
    await syncPendingOperations(adapter);
    await queueEdit(adapter, 6, FIRST_ROW_AT + 10);
    fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });
    fakeBridge.queueResponse({ status: 202, body: buildReconcileResponseBody({ lastChangelogId: 1 }) });

    await syncPendingOperations(adapter);

    expect((await readOperationRows(adapter)).map((row) => row.unresolved_reason)).toEqual(['bridge_404', 'bridge_404']);
    expect(await readUnresolvedKeyCount(adapter)).toBe(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('removes an unresolved rating once a later rating of the same anime and season is confirmed, and logs it', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rateAndSync(adapter, fakeBridge, 'anime-1', 409);

    await rateAndSync(adapter, fakeBridge, 'anime-1', 204);

    expect(await readRatingRows(adapter)).toEqual([
      { id: 2, anime_id: 'anime-1', status: 'synced', unresolved_reason: null },
    ]);
    expect(info).toHaveBeenCalledWith('[unresolved] resolved automatically', {
      key: { kind: 'season_rating', seasonId: 'season-1', animeId: 'anime-1' },
      reason: 'superseded by confirmed rating 2',
      rows: [{ id: 1, unresolvedReason: 'conflict' }],
    });
  });

  it('never resolves an unresolved rating of another anime', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rateAndSync(adapter, fakeBridge, 'anime-1', 404);

    await rateAndSync(adapter, fakeBridge, 'anime-2', 204);

    expect(await readRatingRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'dead_letter', unresolved_reason: 'not_found' },
      { id: 2, anime_id: 'anime-2', status: 'synced', unresolved_reason: null },
    ]);
    expect(info).not.toHaveBeenCalled();
  });
});
