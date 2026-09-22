import { createSyncCycleCheckpointStore } from '../../../src/infrastructure/db/sync-cycle-checkpoint';
import { runHeadlessSyncCycle } from '../../../src/features/sync/headless-sync-cycle.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as operationLogRetention from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncRuntimeStatus from '../../../src/features/sync/sync-runtime-status.helpers';

jest.mock('../../../src/infrastructure/db/sync-cycle-checkpoint/sync-cycle-checkpoint.helpers', () => ({
  createSyncCycleCheckpointStore: jest.fn(),
}));

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
  pruneOperationLog: jest.fn().mockResolvedValue({ prunedCount: 0 }),
}));

jest.mock('../../../src/features/sync/operation-log-convergence.helpers', () => ({
  readOperationLogConvergence: jest.fn().mockResolvedValue({ pendingRowCount: 1 }),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  getSyncRuntimeStatusSnapshot: jest.fn(),
  recordBacklogReadCount: jest.fn().mockResolvedValue(undefined),
  recordCycleActive: jest.fn().mockResolvedValue(undefined),
  recordPrunedOperationsCount: jest.fn().mockResolvedValue(undefined),
  recordSyncAttemptFailed: jest.fn().mockResolvedValue(undefined),
  recordSyncAttemptStarted: jest.fn().mockResolvedValue(undefined),
  recordSyncAttemptSucceeded: jest.fn().mockResolvedValue(undefined),
}));

jest.mock(
  '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers',
  () => ({
    drainDiagnosticEvents: jest.fn().mockReturnValue([]),
    recordDiagnosticEvent: jest.fn(),
  }),
);

jest.mock(
  '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
  () => ({
    syncDiagnosticsOutboxStore: { getFailedWriteCount: jest.fn().mockReturnValue(0) },
  }),
);

/** Mocked checkpoint-store factory; each test inspects what the cycle created and recorded. */
const mockCreateStore = createSyncCycleCheckpointStore as jest.Mock;
/** Mocked `getBridgeConfigSnapshot` giving the cycle a configured bridge. */
const mockGetBridgeConfigSnapshot = dbClient.getBridgeConfigSnapshot as jest.Mock;
/** Mocked `withLocalWrite`, resolved without running its callback. */
const mockWithLocalWrite = dbClient.withLocalWrite as jest.Mock;
/** Mocked bridge endpoint whose rejection shapes the reconcile-failure test. */
const mockReconcile = bridgeClient.reconcile as jest.Mock;
/** Mocked backlog read returning one pending operation per test. */
const mockReadBacklog = operationLogRetention.readOperationLogBacklog as jest.Mock;
/** Mocked pre-cycle runtime snapshot read. */
const mockGetSnapshot = syncRuntimeStatus.getSyncRuntimeStatusSnapshot as jest.Mock;

/** Stages the mocked store captured, in record order. */
let recordedStages: string[];
/** Params (`cycleId`, `startedAt`) the cycle passed to the store factory, if it did. */
let storeParams: { cycleId: string; startedAt: number } | undefined;

/** Builds the minimal runtime stub `runHeadlessSyncCycle` touches. */
function buildRuntime(openImpl: () => Promise<unknown>): never {
  return {
    owner: 'background_task',
    rawDb: null,
    isOpen: () => false,
    open: jest.fn(openImpl),
    withDatabase: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  } as never;
}

describe('runHeadlessSyncCycle checkpoint wiring (T2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordedStages = [];
    storeParams = undefined;

    mockCreateStore.mockImplementation((params: { cycleId: string; startedAt: number }) => {
      storeParams = params;

      return {
        record: (stage: string) => {
          recordedStages.push(stage);
        },
        getFailedCheckpointCount: () => 0,
        readLastCheckpoint: jest.fn().mockResolvedValue(null),
      };
    });
    mockGetSnapshot.mockResolvedValue({ lastCycleStage: null });
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

  it('records the full ordered stage sequence and ends a healthy cycle at `closed`', async () => {
    const rawDb = { name: 'headless-checkpoint-healthy-db' };
    const runtime = buildRuntime(() => Promise.resolve(rawDb));

    const result = await runHeadlessSyncCycle({
      runtime,
      triggerSource: 'background_task',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 0 });
    expect(mockCreateStore).toHaveBeenCalledTimes(1);
    expect(storeParams).toEqual(
      expect.objectContaining({ cycleId: expect.any(String), startedAt: expect.any(Number) }),
    );
    expect(recordedStages).toEqual([
      'open',
      'config',
      'attempt_started',
      'cycle_activated',
      'backlog_read',
      'claim_ops',
      'http',
      'parse_response',
      'apply_write',
      'prune',
      'closed',
    ]);
  });

  it('leaves the last recorded stage inside the reconcile vocabulary when the pass throws', async () => {
    mockReconcile.mockRejectedValue(new Error('reconcile exploded'));

    const rawDb = { name: 'headless-checkpoint-reconcile-throw-db' };
    const runtime = buildRuntime(() => Promise.resolve(rawDb));

    const result = await runHeadlessSyncCycle({
      runtime,
      triggerSource: 'background_task',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(recordedStages).toEqual([
      'open',
      'config',
      'attempt_started',
      'cycle_activated',
      'backlog_read',
      'claim_ops',
      'http',
    ]);
    expect(recordedStages[recordedStages.length - 1]).toBe('http');
  });

  it('mints the cycle id before the first await: a failed open already has a store and an `open` checkpoint', async () => {
    const runtime = buildRuntime(() => Promise.reject(new Error('open failed')));

    await expect(
      runHeadlessSyncCycle({ runtime, triggerSource: 'background_task' }),
    ).rejects.toThrow('open failed');

    expect(mockCreateStore).toHaveBeenCalledTimes(1);
    expect(storeParams).toEqual(
      expect.objectContaining({ cycleId: expect.any(String), startedAt: expect.any(Number) }),
    );
    expect(recordedStages).toEqual(['open']);
  });
});
