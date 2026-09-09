import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncDiagnosticsFlushModule from '../../../src/features/sync/sync-diagnostics-flush.helpers';
import type { SyncRuntimeStatusSnapshot } from '../../../src/features/sync/sync-runtime-status.types';

// The remaining collaborators `syncPendingOperations` reaches for -- the merge boundary, the
// pending-remote-changes stager, and the anime bridge-token reader -- are mocked below by module
// path only. This suite never asserts on their calls directly, only on the diagnostics wiring
// (capture/flush) that sits around `bridgeClient.reconcile`.

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

/** Builds a neutral runtime snapshot so each test only states the fields it actually exercises. */
function buildSnapshot(
  overrides: Partial<SyncRuntimeStatusSnapshot> = {},
): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: 'registered',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureMessage: null,
    lastTriggerSource: null,
    lastSyncedCount: 0,
    isCycleActive: false,
    lastBacklogReadCount: 0,
    lastPrunedOperationsCount: 0,
    isBackgroundTaskRegistered: false,
    lastCycleId: null,
    lastCycleStage: null,
    lastErrorName: null,
    lastNativeErrcodeByte: null,
    lastErrorStage: null,
    consecutiveUnclosedCycles: 0,
    lastCycleStageAt: null,
    lastFailedCheckpointCount: 0,
    ...overrides,
  };
}

describe('syncPendingOperations diagnostics wiring (Decision 5)', () => {
  const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
  const mockReconcile = bridgeClient.reconcile as jest.Mock;
  const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
  const mockCountBacklogRows = operationLogRetention.countOperationLogBacklogRows as jest.Mock;
  const mockCapture = syncDiagnosticsFlushModule.captureSyncDiagnosticsEnvelope as jest.Mock;
  const mockFlush = syncDiagnosticsFlushModule.flushSyncDiagnosticsOutbox as jest.Mock;

  const telemetryContext = {
    cycleId: 'cycle-diagnostics-1',
    triggerSource: 'background_task' as const,
    appState: 'background' as const,
    snapshot: buildSnapshot(),
    recentEvents: [],
  };

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

  it('captures the envelope even when bridgeClient.reconcile throws -- the headline inversion', async () => {
    mockReconcile.mockRejectedValue(new Error('network down'));

    const rawDb = { name: 'diagnostics-throwing-reconcile-db' };

    await expect(
      syncPendingOperations(rawDb as never, 'deferred', telemetryContext),
    ).rejects.toThrow('network down');

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ cycle_id: 'cycle-diagnostics-1' }),
    );
  });

  it('never routes a rejecting flush into revertPendingOperationsOnFailure -- its own failure is not a reconcile failure', async () => {
    mockFlush.mockRejectedValue(new Error('diagnostics link down'));

    const rawDb = { name: 'diagnostics-throwing-flush-db' };

    await expect(
      syncPendingOperations(rawDb as never, 'deferred', telemetryContext),
    ).rejects.toThrow('diagnostics link down');

    // The flush sits BEFORE the try, so a rejecting flush must stop the cycle before reconcile
    // is ever reached, and it must never trigger the operation_log revert write that follows a
    // genuine reconcile failure.
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(dbClient.withLocalWrite).toHaveBeenCalledTimes(1);
  });
});
