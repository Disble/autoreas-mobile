import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: { reconcile: jest.fn() },
}));

jest.mock('../../../src/features/sync/sync-diagnostics-flush.helpers', () => ({
  captureSyncDiagnosticsEnvelope: jest.fn(),
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

jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  readOperationLogBacklog: jest.fn().mockResolvedValue([]),
  countOperationLogBacklogRows: jest.fn().mockResolvedValue(0),
}));

/** Mocked `getBridgeConfigSnapshot` the suite drives per test. */
const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
/** Mocked `withLocalWrite`, resolved without running its callback unless a test overrides it. */
const mockWithLocalWrite = dbClient.withLocalWrite as jest.Mock;
/** Mocked bridge endpoint the suite drives per test. */
const mockReconcile = bridgeClient.reconcile as jest.Mock;
/** Mocked backlog read; empty by default (the module mock's own default). */
const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;

/** A successful, empty reconcile response fixture shared by this suite's happy-path tests. */
const SUCCESS_RESPONSE = {
  ok: true,
  status: 202,
  url: 'https://192.168.1.10:9876/api/sync/reconcile',
  rawBody: '{}',
  data: { status: 'accepted', applied_operations: [], bridge_changes: [], conflicts: [] },
};

describe('syncPendingOperations in-flight guard', () => {
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
    mockWithLocalWrite.mockResolvedValue(undefined);
    mockReconcile.mockResolvedValue(SUCCESS_RESPONSE);
  });

  it('a call arriving while one is already in flight joins it: both callers observe the identical settled result', async () => {
    const rawDb = { name: 'in-flight-db' };

    // Both calls fire synchronously, with no await between them: by the time the second call
    // runs, the first has already published its in-flight promise (design.md's per-database
    // guard), so the second must mark a rerun and return that SAME in-flight work instead of
    // starting its own independent reconcile pass. Two independently-computed result objects
    // would only ever be deep-equal by coincidence (the mock is stable across calls); object
    // IDENTITY is what proves the second caller was handed the first caller's own in-flight
    // promise rather than a lookalike result from a second, unguarded pass.
    const firstResult = syncPendingOperations(rawDb as never);
    const secondResult = syncPendingOperations(rawDb as never);

    const [firstValue, secondValue] = await Promise.all([firstResult, secondResult]);

    expect(firstValue).toBe(secondValue);
    // One pass for the first call, one rerun pass triggered by the second call joining it --
    // not two fully independent reconcile round-trips.
    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });

  it('a call after the previous one has settled starts its own independent pass (no rerun)', async () => {
    const rawDb = { name: 'sequential-db' };

    await syncPendingOperations(rawDb as never);
    await syncPendingOperations(rawDb as never);

    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });
});

describe('syncPendingOperations response and revert error paths', () => {
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
    mockWithLocalWrite.mockResolvedValue(undefined);
  });

  it('rejects with a parse error when the bridge response fails ReconcileResponseSchema', async () => {
    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      // `status` is required by the schema; its absence must fail validation, not silently
      // coerce into a fake success.
      data: { applied_operations: [], bridge_changes: [], conflicts: [] },
    });
    const rawDb = { name: 'invalid-response-db' };

    await expect(syncPendingOperations(rawDb as never)).rejects.toThrow(
      'Invalid reconcile response',
    );
  });

  it('reverts nothing (no extra write) when the backlog was already empty and the bridge call fails', async () => {
    mockReconcile.mockRejectedValue(new Error('network down'));
    const rawDb = { name: 'empty-backlog-failure-db' };

    await expect(syncPendingOperations(rawDb as never)).rejects.toThrow('network down');

    // With an empty backlog, `withLocalWrite` is never called at all: not for claiming rows
    // (skipped: `pendingOps.length === 0`) and not for the revert either
    // (`revertPendingOperationsOnFailure`'s own empty-array early return). A call here would
    // mean the empty-backlog guard on the revert path was lost.
    expect(mockWithLocalWrite).not.toHaveBeenCalled();
  });
});
