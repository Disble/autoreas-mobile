import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as animeRepository from '../../../src/infrastructure/db/anime-repository';
import * as mergeApplyChangesModule from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import * as mergeContextModule from '../../../src/features/sync/merge/merge-context.helpers';
import * as pendingRemoteChangesModule from '../../../src/features/sync/pending-remote-changes.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withLocalWrite: jest.fn(),
  createDrizzleDb: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  persistConfirmedAnimeTokens: jest.fn().mockResolvedValue(undefined),
  readAnimeBridgeTokens: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../../src/features/sync/merge/apply-remote-changes.helpers', () => ({
  applyRemoteChanges: jest.fn().mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 }),
}));

jest.mock('../../../src/features/sync/merge/merge-context.helpers', () => ({
  loadGuardMap: jest.fn().mockResolvedValue(new Map()),
  loadPendingOutboxRecordIds: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../../src/features/sync/pending-remote-changes.helpers', () => ({
  stagePendingRemoteChanges: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  readOperationLogBacklog: jest.fn().mockResolvedValue([]),
  countOperationLogBacklogRows: jest.fn().mockResolvedValue(0),
}));

/**
 * Covers Phase 5's net-new confirmed write-back wiring inside `syncPendingOperations`: ordering
 * against the `bridge_changes` apply, the never-read-snapshot invariant, and the row-absent
 * no-throw case. Split out of `reconcile.helpers.test.ts` to keep that file under the 500-line
 * ceiling (constraint 5).
 */
describe('syncPendingOperations confirmed token write-back', () => {
  const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
  const mockReconcile = bridgeClient.reconcile as jest.Mock;
  const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
  const mockApplyRemoteChanges = mergeApplyChangesModule.applyRemoteChanges as jest.Mock;
  const mockLoadGuardMap = mergeContextModule.loadGuardMap as jest.Mock;
  const mockLoadPendingOutboxRecordIds =
    mergeContextModule.loadPendingOutboxRecordIds as jest.Mock;
  const mockStagePendingRemoteChanges =
    pendingRemoteChangesModule.stagePendingRemoteChanges as jest.Mock;
  const mockPersistConfirmedAnimeTokens =
    animeRepository.persistConfirmedAnimeTokens as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadBacklog.mockResolvedValue([]);
    mockPersistConfirmedAnimeTokens.mockResolvedValue(undefined);
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
    mockApplyRemoteChanges.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0 });
    mockLoadGuardMap.mockResolvedValue(new Map());
    mockLoadPendingOutboxRecordIds.mockResolvedValue(new Set());
    mockStagePendingRemoteChanges.mockResolvedValue(undefined);
  });

  it('deferred mode: persists confirmed tokens AFTER applyRemoteChanges, inside the same withLocalWrite invocation', async () => {
    const callOrder: string[] = [];
    mockApplyRemoteChanges.mockImplementation(async () => {
      callOrder.push('applyRemoteChanges');
      return { applied: 1, dropped: 0, deferred: 0 };
    });
    mockPersistConfirmedAnimeTokens.mockImplementation(async () => {
      callOrder.push('persistConfirmedAnimeTokens');
    });

    const writeDb = {};
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-1', operation: 'update', applied: true, modified_at: 1788540735366 },
        ],
        bridge_changes: [],
      },
    });

    const rawDb = { name: 'deferred-reconcile-db-token-order' };
    await syncPendingOperations(rawDb as never);

    expect(callOrder).toEqual(['applyRemoteChanges', 'persistConfirmedAnimeTokens']);
    expect(mockPersistConfirmedAnimeTokens).toHaveBeenCalledWith(writeDb, [
      { animeId: 'anime-1', bridgeModifiedAt: 1788540735366 },
    ]);
    expect(dbClient.withLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('staged mode: persists confirmed tokens AFTER stagePendingRemoteChanges, inside the same withLocalWrite invocation', async () => {
    const callOrder: string[] = [];
    mockStagePendingRemoteChanges.mockImplementation(async () => {
      callOrder.push('stagePendingRemoteChanges');
    });
    mockPersistConfirmedAnimeTokens.mockImplementation(async () => {
      callOrder.push('persistConfirmedAnimeTokens');
    });

    const writeDb = {};
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-1', operation: 'update', applied: true, modified_at: 0 },
        ],
        bridge_changes: [],
      },
    });

    const rawDb = { name: 'staged-reconcile-db-token-order' };
    await syncPendingOperations(rawDb as never, 'staged');

    expect(callOrder).toEqual(['stagePendingRemoteChanges', 'persistConfirmedAnimeTokens']);
    expect(mockPersistConfirmedAnimeTokens).toHaveBeenCalledWith(writeDb, [
      { animeId: 'anime-1', bridgeModifiedAt: 0 },
    ]);
    expect(dbClient.withLocalWrite).toHaveBeenCalledTimes(1);
  });

  it('never reads bridge_changes[].snapshot.modified_at as a token source (invariant 1)', async () => {
    const writeDb = {};
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [],
        bridge_changes: [
          {
            record_id: 'anime-1',
            change_type: 'update',
            changed_fields: ['status'],
            snapshot: {
              id: 'anime-1',
              name: 'Test',
              status: 2,
              episodesWatched: 0,
              active: 1,
              firstCycle: 0,
              days: [],
              genres: [],
              modified_at: 999999999,
            },
            timestamp: 1710000001000,
          },
        ],
      },
    });

    const rawDb = { name: 'deferred-reconcile-db-snapshot-token-ignored' };
    await syncPendingOperations(rawDb as never);

    // No applied_operations entry in this response -- the only valid token source is empty, so
    // persistConfirmedAnimeTokens must be called with an empty batch, never with the snapshot's
    // (hardcoded-to-0-by-the-bridge, but even if nonzero here) modified_at.
    expect(mockPersistConfirmedAnimeTokens).toHaveBeenCalledWith(writeDb, []);
  });

  it('an applied_operations entry whose anime_id is absent from animes writes nothing and throws nothing', async () => {
    const writeDb = {};
    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });
    // Simulates the real repository's behavior against a row that does not exist yet: an UPDATE
    // matching zero rows resolves normally, it never rejects.
    mockPersistConfirmedAnimeTokens.mockResolvedValue(undefined);

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [
          { anime_id: 'anime-not-yet-applied', operation: 'create', applied: true, modified_at: 1788540735366 },
        ],
        bridge_changes: [],
      },
    });

    const rawDb = { name: 'staged-reconcile-db-token-orphan' };
    await expect(syncPendingOperations(rawDb as never, 'staged')).resolves.toBeDefined();

    expect(mockPersistConfirmedAnimeTokens).toHaveBeenCalledWith(writeDb, [
      { animeId: 'anime-not-yet-applied', bridgeModifiedAt: 1788540735366 },
    ]);
  });
});
