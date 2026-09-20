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
/** Mocked `withLocalWrite`, resolved without running its callback. */
const mockWithLocalWrite = dbClient.withLocalWrite as jest.Mock;
/** Mocked bridge endpoint whose rejection shapes the failure tests. */
const mockReconcile = bridgeClient.reconcile as jest.Mock;
/** Mocked backlog read returning one pending operation per test. */
const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;

/**
 * Reads the stage names a recorder captured, in order.
 * The recorder's whole contract is ENTRY ordering, so the assertion surface is the flat list.
 */
function recordedStages(recorder: jest.Mock): string[] {
  return recorder.mock.calls.map((call) => call[0] as string);
}

describe('syncPendingOperations checkpoint wiring (T1)', () => {
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
    mockGetBridgeConfigSnapshot.mockResolvedValue({
      id: 1,
      ip: '192.168.1.10',
      port: 9876,
      token: 'auth-secret',
      deviceId: 'device-1',
      lastChangelogId: 0,
    });
    mockWithLocalWrite.mockResolvedValue(undefined);
    mockReconcile.mockResolvedValue({
      ok: true,
      status: 202,
      url: 'https://192.168.1.10:9876/api/sync/reconcile',
      rawBody: '{}',
      data: { status: 'accepted', applied_operations: [], bridge_changes: [], conflicts: [] },
    });
  });

  it('publishes the exact ordered checkpoint sequence for one successful pass', async () => {
    const recorder = jest.fn();
    const rawDb = { name: 'checkpoint-success-db' };

    const result = await syncPendingOperations(rawDb as never, 'deferred', undefined, recorder);

    expect(result.syncedCount).toBe(0);
    expect(recordedStages(recorder)).toEqual([
      'backlog_read',
      'claim_ops',
      'http',
      'parse_response',
      'apply_write',
    ]);
  });

  it('leaves the last recorded stage at `http` when the bridge call throws', async () => {
    mockReconcile.mockRejectedValue(new Error('network down'));

    const recorder = jest.fn();
    const rawDb = { name: 'checkpoint-http-throw-db' };

    await expect(
      syncPendingOperations(rawDb as never, 'deferred', undefined, recorder),
    ).rejects.toThrow('network down');

    const stages = recordedStages(recorder);

    expect(stages[stages.length - 1]).toBe('http');
    expect(stages).not.toContain('parse_response');
    expect(stages).not.toContain('apply_write');
  });

  it('never fails the pass when the recorder itself throws', async () => {
    const recorder = jest.fn(() => {
      throw new Error('instrument blew up');
    });
    const rawDb = { name: 'checkpoint-throwing-recorder-db' };

    const result = await syncPendingOperations(rawDb as never, 'deferred', undefined, recorder);

    expect(recorder).toHaveBeenCalled();
    expect(result.syncedCount).toBe(0);
  });

  it('stays optional: the pass works end to end without a recorder', async () => {
    const rawDb = { name: 'checkpoint-omitted-recorder-db' };

    const result = await syncPendingOperations(rawDb as never, 'deferred');

    expect(result).toEqual(
      expect.objectContaining({ syncedCount: 0, backlogReadCount: 1, hasMorePending: true }),
    );
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});
