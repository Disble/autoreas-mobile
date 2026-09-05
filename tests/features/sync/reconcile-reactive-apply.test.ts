import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as mergeApplyChangesModule from '../../../src/features/sync/merge/apply-remote-changes.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/infrastructure/db/anime-repository', () => ({
  upsertAnime: jest.fn().mockResolvedValue(undefined),
  persistConfirmedAnimeTokens: jest.fn().mockResolvedValue(undefined),
  readAnimeBridgeTokens: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withLocalWrite: jest.fn().mockResolvedValue(undefined),
  createDrizzleDb: jest.fn().mockReturnValue({}),
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

/** Mocks `getBridgeConfigSnapshot`, controlling whether the bridge connection is configured. */
const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
/** Mocks the bridge client's `reconcile` HTTP call. */
const mockReconcile = bridgeClient.reconcile as jest.Mock;
/** Mocks `readOperationLogBacklog`, controlling the pending-operation batch read from the queue. */
const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;

describe('reconcile applies remote bridge changes reactively', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadBacklog.mockResolvedValue([]);
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
  });

  it('writes pulled changes through the shared reactive connection so useLiveQuery refreshes immediately', async () => {
    const writeDb = {};

    (dbClient.withLocalWrite as jest.Mock).mockImplementation(async (_db, task) => {
      await task(writeDb, {});
    });

    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'http://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: {
        status: 'accepted',
        applied_operations: [],
        bridge_changes: [
          {
            record_id: 'anime-1',
            change_type: 'delete',
            changed_fields: [],
            timestamp: 1710000001000,
          },
        ],
        conflicts: [],
      },
    });

    // Fresh rawDb identity avoids the per-database in-flight guard carrying state across tests.
    const rawDb = { name: 'reactive-reconcile-db' };
    await syncPendingOperations(rawDb as never);

    expect(dbClient.withLocalWrite).toHaveBeenCalledWith(rawDb, expect.any(Function));
    expect(mergeApplyChangesModule.applyRemoteChanges).toHaveBeenCalledWith(
      writeDb,
      expect.arrayContaining([
        expect.objectContaining({ recordId: 'anime-1', changeType: 'delete' }),
      ]),
      expect.objectContaining({
        guardByRecordId: expect.any(Map),
        pendingOutboxRecordIds: expect.any(Set),
      }),
      'deferred',
    );
  });
});
