import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncDiagnosticsFlushModule from '../../../src/features/sync/sync-diagnostics-flush.helpers';
import { createRequestIdSequence } from '../../../src/features/sync/request-id.helpers';
import type { RequestIdSequence } from '../../../src/features/sync/request-id.types';
import * as animeRepository from '../../../src/infrastructure/db/anime-repository';

// The remaining collaborators `syncPendingOperations` reaches for -- the merge boundary, the
// pending-remote-changes stager, and the anime bridge-token reader -- are mocked below by module
// path only. This suite never asserts on their calls directly, only on the diagnostics wiring
// (the outbox flush) that sits before `bridgeClient.reconcile`.

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/features/sync/sync-diagnostics-flush.helpers', () => ({
  flushSyncDiagnosticsOutbox: jest
    .fn()
    .mockResolvedValue({ attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 }),
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

jest.mock('../../../src/features/sync/outbox-claim.helpers', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
  require('../../support/outbox-claim-mock.helpers').buildPassThroughOutboxClaimModule(),
);
jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  readOperationLogBacklog: jest.fn().mockResolvedValue([]),
  countOperationLogBacklogRows: jest.fn().mockResolvedValue(0),
}));

describe('syncPendingOperations diagnostics wiring (Decision 5)', () => {
  const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
  const mockReconcile = bridgeClient.reconcile as jest.Mock;
  const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
  const mockCountBacklogRows = operationLogRetention.countOperationLogBacklogRows as jest.Mock;
  const mockFlush = syncDiagnosticsFlushModule.flushSyncDiagnosticsOutbox as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadBacklog.mockResolvedValue([
      {
        id: 1,
        animeId: 'anime-1',
        operation: 'update',
        payload: '{}',
        status: 'processing',
        createdAt: 100,
      },
    ]);
    mockCountBacklogRows.mockResolvedValue(1);
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
    mockFlush.mockResolvedValue({ attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 });
    (dbClient.withLocalWrite as jest.Mock).mockResolvedValue(undefined);
    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: { status: 'accepted', applied_operations: [], bridge_changes: [], conflicts: [] },
    });
  });

  it('never routes a rejecting flush into revertPendingOperationsOnFailure -- its own failure is not a reconcile failure', async () => {
    mockFlush.mockRejectedValue(new Error('diagnostics link down'));

    const rawDb = { name: 'diagnostics-throwing-flush-db' };

    await expect(
      syncPendingOperations(rawDb as never),
    ).rejects.toThrow('diagnostics link down');

    // The flush sits BEFORE the try, so a rejecting flush must stop the cycle before reconcile
    // is ever reached, and it must never trigger the operation_log revert write that follows a
    // genuine reconcile failure. The claim owns its own door (`claimOperationLogBatch`, stubbed
    // here), so any `withLocalWrite` call at all would be that revert.
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(dbClient.withLocalWrite).not.toHaveBeenCalled();
  });
  it("numbers the flush and the reconcile after it in one cycle's sequence (S4)", async () => {
    (animeRepository.readAnimeBridgeTokens as jest.Mock).mockResolvedValueOnce(new Map([['anime-1', 5]]));
    // The flush posts one envelope, so it takes the cycle's first id.
    mockFlush.mockImplementationOnce(async (params: { requestIds: RequestIdSequence }) => {
      params.requestIds.next();
      return { attempted: 1, delivered: 1, discarded: 0, failedRemovals: 0 };
    });

    // The stubbed write door cannot apply the answer, so the pass fails after the request: only
    // the request is under test here.
    await syncPendingOperations({ name: 'numbered-cycle-db' } as never, createRequestIdSequence('cycle-9'))
      .catch(() => undefined);

    expect(mockReconcile).toHaveBeenCalledWith(expect.anything(), expect.anything(), { requestId: 'cycle-9:2' });
  });
});
