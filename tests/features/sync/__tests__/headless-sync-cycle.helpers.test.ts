import type { SQLiteDatabase } from 'expo-sqlite';
import * as dbClient from '../../../../src/infrastructure/db/client/client.helpers';
import { LocalWriteError } from '../../../../src/infrastructure/db/client/client.errors';
import * as retentionModule from '../../../../src/features/sync/operation-log-retention.helpers';
import * as syncModule from '../../../../src/features/sync/reconcile.helpers';
import { runHeadlessSyncCycle } from '../../../../src/features/sync/headless-sync-cycle.helpers';
import * as runtimeStatusModule from '../../../../src/features/sync/sync-runtime-status.helpers';
import * as syncTelemetryModule from '../../../../src/features/sync/sync-telemetry.helpers';
import type { SyncSQLiteRuntime } from '../../../../src/features/sync/sqlite-sync-runtime.types';

/** Pinned so a single cycle's mint can be asserted to reappear, byte-for-byte, at every write. */
const FIXED_CYCLE_ID = 'cycle-fixed-id';

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  openAppDatabaseSync: jest.fn(),
  runMigrations: jest.fn(),
}));

// Only `createSyncCycleId` is pinned; every classifier (`causeFromError`,
// `normalizeSyncCycleErrorName`/`Stage`, `normalizeNativeErrcodeByte`) stays real, so the
// failure-detail assertions below exercise the actual closed-vocabulary classification instead
// of a second, hand-rolled taxonomy.
jest.mock('../../../../src/features/sync/sync-telemetry.helpers', () => ({
  ...jest.requireActual('../../../../src/features/sync/sync-telemetry.helpers'),
  createSyncCycleId: jest.fn(() => FIXED_CYCLE_ID),
}));

jest.mock('../../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../../src/features/sync/operation-log-retention.helpers', () => ({
  pruneOperationLog: jest.fn(),
}));

jest.mock('../../../../src/features/sync/sync-runtime-status.helpers', () => ({
  // The cycle reads the PREVIOUS cycle's snapshot before it records its own attempt, so the
  // telemetry post-mortem describes the run that died rather than the one starting now.
  getSyncRuntimeStatusSnapshot: jest.fn().mockResolvedValue({
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
  }),
  recordBacklogReadCount: jest.fn(),
  recordCycleActive: jest.fn(),
  recordPrunedOperationsCount: jest.fn(),
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

describe('headless-sync-cycle helpers', () => {
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

  function buildRuntime(): SyncSQLiteRuntime {
    return {
      owner: 'headless_cycle',
      rawDb,
      isOpen: () => true,
      open: jest.fn().mockResolvedValue(rawDb),
      withDatabase: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as SyncSQLiteRuntime;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    (dbClient.runMigrations as jest.Mock).mockResolvedValue(undefined);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.9',
      port: 3000,
      token: 'secret',
      deviceId: 'device-1',
      deviceName: 'Bridge Casa',
      lastChangelogId: 0,
    });
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 3,
      backlogReadCount: 5,
      hasMorePending: false,
    });
    (retentionModule.pruneOperationLog as jest.Mock).mockResolvedValue({
      prunedCount: 7,
      deletedSyncedCount: 4,
      deletedDeadLetterCount: 3,
    });
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordCycleActive as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordBacklogReadCount as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordPrunedOperationsCount as jest.Mock).mockResolvedValue(undefined);
  });

  it('persists attempt and success for a foreground service cycle, applying in staged mode (never deferred)', async () => {
    const runtime = buildRuntime();
    const result = await runHeadlessSyncCycle({
      runtime,
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(runtime.open).toHaveBeenCalled();
    expect(dbClient.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      FIXED_CYCLE_ID,
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, true);
    // The headless/background runtime owns an isolated, non-reactive connection
    // (enableChangeListener:false). It MUST pass 'staged' so the reconcile apply step never
    // writes `animes` directly on this connection -- a mis-set 'deferred' here would
    // silently reintroduce the non-reactive-write regression with no UI feedback.
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(
      rawDb,
      'staged',
      // The telemetry context rides along on the same call: it is assembled here, before the
      // status writes, because only this caller can see the previous cycle's snapshot intact.
      expect.objectContaining({ appState: 'background' }),
    );
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalledWith(rawDb, 'deferred');
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordBacklogReadCount).toHaveBeenCalledWith(rawDb, 5);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      3,
      FIXED_CYCLE_ID,
    );
    expect(retentionModule.pruneOperationLog).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordPrunedOperationsCount).toHaveBeenCalledWith(rawDb, 7);
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, false);
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
    // The cycle mints its correlation id exactly once and threads that SAME value into both
    // writes -- not a fresh id per write, which would make the two records uncorrelatable.
    expect(syncTelemetryModule.createSyncCycleId).toHaveBeenCalledTimes(1);
  });

  it('still threads the cycle id into recordSyncAttemptStarted when the previous cycle never closed', async () => {
    // `consecutiveUnclosedCycles` itself is derived purely inside `buildSyncAttemptStartedPatch`
    // from this snapshot (unit-tested in `sync-runtime-status.helpers.test.ts`); this only
    // guards that wiring the cycle id here does not disturb that existing bookkeeping path.
    (runtimeStatusModule.getSyncRuntimeStatusSnapshot as jest.Mock).mockResolvedValueOnce({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      lastAttemptAt: Date.now() - 1_000,
      lastSuccessAt: null,
      lastFailureMessage: null,
      lastTriggerSource: 'background_task',
      lastSyncedCount: 0,
      isCycleActive: true,
      lastBacklogReadCount: 0,
      lastPrunedOperationsCount: 0,
      isBackgroundTaskRegistered: true,
      lastCycleId: 'previous-cycle-id',
      lastCycleStage: 'reconcile',
      lastErrorName: null,
      lastNativeErrcodeByte: null,
      lastErrorStage: null,
      consecutiveUnclosedCycles: 2,
      lastCycleStageAt: Date.now() - 1_000,
      lastFailedCheckpointCount: 0,
    });

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'background_task',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'background_task',
      expect.any(Number),
      FIXED_CYCLE_ID,
    );
  });

  it('returns no-op without pairing and avoids fake success', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.9',
      port: 3000,
      token: 'secret',
      deviceId: null,
      deviceName: 'Bridge Casa',
      lastChangelogId: 0,
    });

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'no_op', syncedCount: 0 });
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptStarted).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordCycleActive).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('persists a failed foreground service cycle without fabricating success', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      FIXED_CYCLE_ID,
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, true);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'Network Error',
      {
        cycleId: FIXED_CYCLE_ID,
        // 'reconcile' has no EXACT `SyncCycleStage` correspondence -- it spans backlog_read,
        // claim_ops, http, parse_response AND apply_write, including local SQLite writes. Any
        // single guess (e.g. 'http') would misreport a local write-door jam as a transport
        // failure, so this reports `null` and leaves the discrimination to the error triple
        // below (see `HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE`'s doc comment).
        stage: null,
        // A bare `Error` has no class on the closed allowlist, so it collapses to 'unknown'
        // rather than leaking its literal name onto the wire.
        errorName: 'unknown',
        errorStage: null,
        nativeErrcodeByte: null,
      },
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, false);
  });

  it('classifies a caught local-write failure into the closed error vocabulary, with its cycle id and a null stage (no exact correspondence)', async () => {
    const writeError = new LocalWriteError('SQLITE_BUSY: database is locked', {
      errcode: 5,
      elapsedMs: 120,
      stage: 'begin',
    });
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(writeError);

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'SQLITE_BUSY: database is locked',
      {
        cycleId: FIXED_CYCLE_ID,
        // The error triple -- not the stage label -- carries the diagnosis here: a
        // LocalWriteError at stage 'begin' is a write-door jam, distinguishable from a
        // BridgeTimeoutError or ReconcileHttpError at the SAME `null` stage.
        stage: null,
        errorName: 'LocalWriteError',
        errorStage: 'begin',
        nativeErrcodeByte: 5,
      },
    );
  });

  it('reports a null stage for a failure during result bookkeeping too, rather than guessing apply_write', async () => {
    const writeError = new LocalWriteError('Access to closed resource', {
      errcode: null,
      elapsedMs: 40,
      stage: 'begin',
    });
    (runtimeStatusModule.recordBacklogReadCount as jest.Mock).mockRejectedValueOnce(writeError);

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'Access to closed resource',
      {
        cycleId: FIXED_CYCLE_ID,
        // 'result_bookkeeping' has no exact `SyncCycleStage` correspondence either: it is a
        // write-door call this module makes AFTER reconcile succeeds, not reconcile's own
        // `apply_write`. Guessing `apply_write` here would misattribute the failure to the
        // wrong write.
        stage: null,
        errorName: 'LocalWriteError',
        errorStage: 'begin',
        nativeErrcodeByte: null,
      },
    );
  });

  it('returns success when pruning fails after a successful sync', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (retentionModule.pruneOperationLog as jest.Mock).mockRejectedValue(new Error('prune failed'));

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[runHeadlessSyncCycle] Operation-log pruning failed',
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
  });

  // Hard-deadline / abandoned-cycle behavior and `buildAbandonedCycleMessage` moved to the
  // sibling `headless-sync-cycle-deadline.test.ts` (CLAUDE.md #5, the 500-line rule).
});
