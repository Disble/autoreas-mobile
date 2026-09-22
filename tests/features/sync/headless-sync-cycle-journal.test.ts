import type { SQLiteDatabase } from 'expo-sqlite';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as retentionModule from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as convergenceModule from '../../../src/features/sync/operation-log-convergence.helpers';
import { syncDiagnosticsOutboxStore } from '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { runHeadlessSyncCycle } from '../../../src/features/sync/headless-sync-cycle.helpers';
import { HEADLESS_SYNC_CYCLE_DEADLINE_MS } from '../../../src/features/sync/headless-sync-cycle.constants';
import type { JournalTransition } from '../../../src/features/sync/sync-journal/sync-journal.types';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';

/** Pinned so a single cycle's mint can be asserted to reappear, byte-for-byte, at every write. */
const FIXED_CYCLE_ID = 'cycle-fixed-id';

/** The diagnostics-flush result `syncPendingOperations` returns on a successful cycle. */
const DIAGNOSTICS_FLUSH = { attempted: 4, delivered: 1, discarded: 2, failedRemovals: 1 };

/** The operation-log convergence projection `readOperationLogConvergence` returns. */
const CONVERGENCE = {
  deadLetterCount: 3,
  conflictExhaustedCount: 1,
  stuckProcessingCount: 2,
  oldestPendingAgeMs: 5_000,
  pendingRowCount: 210,
  hasMore: true,
};

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  openAppDatabaseSync: jest.fn(),
  runMigrations: jest.fn(),
}));

// Only `createSyncCycleId` is pinned; every classifier (`causeFromError`,
// `normalizeSyncCycleErrorName`/`Stage`, `normalizeNativeErrcodeByte`) stays real, so the
// failure-detail assertions below exercise the actual closed-vocabulary classification instead
// of a second, hand-rolled taxonomy.
jest.mock('../../../src/features/sync/sync-telemetry.helpers', () => ({
  ...jest.requireActual('../../../src/features/sync/sync-telemetry.helpers'),
  createSyncCycleId: jest.fn(() => FIXED_CYCLE_ID),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  pruneOperationLog: jest.fn(),
}));

jest.mock('../../../src/features/sync/operation-log-convergence.helpers', () => ({
  readOperationLogConvergence: jest.fn(),
}));

jest.mock(
  '../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants',
  () => ({
    syncDiagnosticsOutboxStore: { getFailedWriteCount: jest.fn() },
  }),
);

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
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

/**
 * The journal is real (its stage→FSM mapping runs for real) but its native write is a mock, so
 * the wiring tests below can assert exactly what the cycle published to the instrument.
 */
const mockJournalRecordTransition = jest.fn((_transition: JournalTransition) =>
  Promise.resolve(true),
);

jest.mock('../../../src/features/sync/sync-journal/sync-journal.helpers', () => ({
  ...jest.requireActual('../../../src/features/sync/sync-journal/sync-journal.helpers'),
  createSyncJournal: jest.fn(() => ({
    recordTransition: mockJournalRecordTransition,
    readLatestTransition: jest.fn().mockResolvedValue(null),
    readTransitions: jest.fn().mockResolvedValue([]),
    countTransitions: jest.fn().mockResolvedValue(0),
    isAvailable: () => true,
  })),
}));

describe('headless-sync-cycle helpers: sync journal instrument', () => {
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
      diagnosticsFlush: DIAGNOSTICS_FLUSH,
    });
    (retentionModule.pruneOperationLog as jest.Mock).mockResolvedValue({
      prunedCount: 7,
      deletedSyncedCount: 4,
      deletedDeadLetterCount: 3,
    });
    (convergenceModule.readOperationLogConvergence as jest.Mock).mockResolvedValue(CONVERGENCE);
    (syncDiagnosticsOutboxStore.getFailedWriteCount as jest.Mock).mockReturnValue(2);
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordCycleActive as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordBacklogReadCount as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordPrunedOperationsCount as jest.Mock).mockResolvedValue(undefined);
  });

  /** The `to_state` column each fire-and-forget journal write carried, in publish order. */
  function recordedToStates(): string[] {
    return mockJournalRecordTransition.mock.calls.map((call) => call[0].toState);
  }

  /** Returns the last transition the cycle published, or fails the test if none was. */
  function lastJournalCall(): JournalTransition {
    const call = mockJournalRecordTransition.mock.calls.at(-1)?.[0];

    if (!call) {
      throw new Error('expected the cycle to publish at least one journal transition');
    }

    return call;
  }

  it('publishes the cycle\'s stage transitions to the journal on the success path', async () => {
    // `syncPendingOperations` is mocked, so its fine-grained stages (`backlog_read`..
    // `apply_write`) never fire here; the cycle's own checkpoints still do.
    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(recordedToStates()).toEqual([
      'checked', // open
      'checked', // config
      'checked', // attempt_started
      'checked', // cycle_activated
      'pruned', // prune
      'closed', // closed
    ]);
    // Every journal row is correlated with the SAME cycle id the other writes used.
    expect(
      mockJournalRecordTransition.mock.calls.every((call) => call[0].cycleId === FIXED_CYCLE_ID),
    ).toBe(true);
  });

  it('records the failed journal transition on the cycle\'s failure path', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    const lastCall = lastJournalCall();
    expect(lastCall.toState).toBe('failed');
    expect(lastCall.fromState).toBe('checked');
    expect(lastCall.reason).toBe('Network Error');
    expect(lastCall.cycleId).toBe(FIXED_CYCLE_ID);
  });

  it('records the abandoned journal transition when the cycle deadline expires', async () => {
    jest.useFakeTimers();
    (syncModule.syncPendingOperations as jest.Mock).mockReturnValue(
      new Promise<never>(() => undefined),
    );

    const pending = runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'background_task',
    });

    await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);
    await pending;

    const lastCall = lastJournalCall();
    expect(lastCall.toState).toBe('abandoned');
    // The cycle parked inside `reconcile`; its last listed journal stage was `cycle_activated`.
    expect(lastCall.fromState).toBe('checked');
    expect(lastCall.reason).toContain('abandoned');
    expect(lastCall.cycleId).toBe(FIXED_CYCLE_ID);

    jest.useRealTimers();
  });

  // Hard-deadline / abandoned-cycle behavior and `buildAbandonedCycleMessage` live in the
  // sibling `headless-sync-cycle-deadline.test.ts` (CLAUDE.md #5, the 500-line rule).
});
