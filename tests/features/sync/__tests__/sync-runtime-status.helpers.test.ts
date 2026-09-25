import {
  getSyncRuntimeStatusSnapshot,
  recordBacklogReadCount,
  recordCycleActive,
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
  withColumnDefault,
  withPatchOverride,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import {
  buildCycleBookkeepingPatch,
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
} from '../../../../src/features/sync/sync-runtime-status-patch.helpers';
import { SYNC_CYCLE_STAGES } from '../../../../src/features/sync/sync-runtime-status.constants';
import {
  SYNC_CYCLE_ERROR_NAMES,
  SYNC_CYCLE_ERROR_STAGES,
} from '../../../../src/features/sync/sync-telemetry.constants';
import type { SyncRuntimeStatusSnapshot } from '../../../../src/features/sync/sync-runtime-status.types';
import type { SyncDiagnosticsFlushResult } from '../../../../src/features/sync/sync-diagnostics-flush.types';
import type { OperationLogConvergence } from '../../../../src/features/sync/operation-log-convergence.types';
import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../../src/infrastructure/db/client/client.helpers';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../../support/sqlite-adapter.helpers';

// The ONLY production modules mocked in this suite, and only to hand drizzle a node:sqlite
// handle instead of expo-sqlite -- the same wiring the behaviour suites use. The drizzle
// migrator is a no-op because `applyMigrationFiles` already ran the same SQL; `runMigrations`
// still executes its idempotent repair steps, which is where the post-0010
// `sync_runtime_status` columns live on installed devices. Everything else (write door,
// singleton upsert, merge semantics) runs for real.
jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** Shared neutral snapshot fixture, so each test only spells out the fields it cares about. */
const NEUTRAL_SNAPSHOT: SyncRuntimeStatusSnapshot = createEmptySyncRuntimeStatusSnapshot();

describe('sync runtime status helpers', () => {
  it('createEmptySyncRuntimeStatusSnapshot retorna el snapshot neutral esperado', () => {
    expect(createEmptySyncRuntimeStatusSnapshot()).toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isCycleActive: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureMessage: null,
      lastTriggerSource: null,
      lastSyncedCount: 0,
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
      lastDiagnosticsDiscardedCount: null,
      lastDiagnosticsFailedRemovalCount: null,
      lastOutboxFailedWriteCount: null,
      lastDeadLetterCount: null,
      lastConflictExhaustedCount: null,
      lastStuckProcessingCount: null,
      lastOldestPendingAgeMs: null,
      lastPendingRowCount: null,
      lastDiagnosticsUndeliverableCount: null,
      lastDiagnosticsUnclassifiedCount: null,
      lastDiagnosticsReapedCount: null,
    });
  });

  it('buildSyncAttemptStartedPatch limpia error previo y registra trigger+attempt', () => {
    expect(
      buildSyncAttemptStartedPatch('background_task', 1710000000000, NEUTRAL_SNAPSHOT),
    ).toEqual({
      lastAttemptAt: 1710000000000,
      lastFailureMessage: null,
      lastTriggerSource: 'background_task',
      lastCycleId: null,
      lastCycleStage: 'attempt_started',
      lastCycleStageAt: 1710000000000,
      lastErrorName: null,
      lastErrorStage: null,
      lastNativeErrcodeByte: null,
      consecutiveUnclosedCycles: 0,
    });
  });

  it('buildSyncAttemptSucceededPatch persiste success y syncedCount observable', () => {
    expect(buildSyncAttemptSucceededPatch('background_task', 1710000005000, 4)).toEqual({
      lastAttemptAt: 1710000005000,
      lastSuccessAt: 1710000005000,
      lastFailureMessage: null,
      lastTriggerSource: 'background_task',
      lastSyncedCount: 4,
      lastCycleId: null,
      lastCycleStage: 'closed',
      lastCycleStageAt: 1710000005000,
      lastErrorName: null,
      lastErrorStage: null,
      lastNativeErrcodeByte: null,
      consecutiveUnclosedCycles: 0,
      isCycleActive: false,
    });
  });

  it('buildSyncAttemptFailedPatch persiste failure sin inventar success', () => {
    expect(
      buildSyncAttemptFailedPatch('background_task', 1710000009000, 'Network Error'),
    ).toEqual({
      lastAttemptAt: 1710000009000,
      lastFailureMessage: 'Network Error',
      lastTriggerSource: 'background_task',
      lastCycleId: null,
      lastCycleStage: null,
      lastCycleStageAt: 1710000009000,
      lastErrorName: null,
      lastErrorStage: null,
      lastNativeErrcodeByte: null,
      consecutiveUnclosedCycles: 0,
      isCycleActive: false,
    });
  });
});

describe('the seven cycle-identity and stage fields are persisted on every attempt lifecycle patch', () => {
  it('a started cycle records its identity and stage', () => {
    const patch = buildSyncAttemptStartedPatch(
      'background_task',
      1710000000000,
      NEUTRAL_SNAPSHOT,
      'cycle-42',
    );

    expect(patch.lastCycleId).toBe('cycle-42');
    expect(patch.lastCycleStage).toBe('attempt_started');
    expect(patch.lastCycleStageAt).toBe(1710000000000);
  });

  it('a succeeded cycle clears the previous error detail', () => {
    const patch = buildSyncAttemptSucceededPatch(
      'background_task',
      1710000005000,
      4,
      'cycle-42',
    );

    expect(patch.lastErrorName).toBeNull();
    expect(patch.lastErrorStage).toBeNull();
    expect(patch.lastNativeErrcodeByte).toBeNull();
  });

  it('a failed cycle records the stage and error it failed with', () => {
    const patch = buildSyncAttemptFailedPatch(
      'background_task',
      1710000009000,
      'Local write failed',
      {
        cycleId: 'cycle-42',
        stage: 'apply_write',
        errorName: 'LocalWriteError',
        errorStage: 'commit',
        nativeErrcodeByte: 5,
      },
    );

    expect(patch.lastCycleId).toBe('cycle-42');
    expect(patch.lastCycleStage).toBe('apply_write');
    expect(patch.lastErrorName).toBe('LocalWriteError');
    expect(patch.lastErrorStage).toBe('commit');
    expect(patch.lastNativeErrcodeByte).toBe(5);
  });

  it('a failed cycle without a classified detail reports null rather than fabricating one', () => {
    const patch = buildSyncAttemptFailedPatch(
      'background_task',
      1710000009000,
      'Sync failed',
    );

    expect(patch.lastCycleId).toBeNull();
    expect(patch.lastCycleStage).toBeNull();
    expect(patch.lastErrorName).toBeNull();
    expect(patch.lastErrorStage).toBeNull();
    expect(patch.lastNativeErrcodeByte).toBeNull();
  });
});

describe('consecutiveUnclosedCycles reflects cycles that started without closing', () => {
  it('increments across consecutive unclosed starts', () => {
    const firstStart = buildSyncAttemptStartedPatch(
      'background_task',
      1710000000000,
      NEUTRAL_SNAPSHOT,
    );

    const afterFirstStart: SyncRuntimeStatusSnapshot = {
      ...NEUTRAL_SNAPSHOT,
      isCycleActive: true,
      consecutiveUnclosedCycles: firstStart.consecutiveUnclosedCycles ?? 0,
    };

    const secondStart = buildSyncAttemptStartedPatch(
      'background_task',
      1710000060000,
      afterFirstStart,
    );

    expect(secondStart.consecutiveUnclosedCycles).toBeGreaterThan(
      firstStart.consecutiveUnclosedCycles ?? 0,
    );
  });

  it('resets to zero once a cycle succeeds', () => {
    const previous: SyncRuntimeStatusSnapshot = {
      ...NEUTRAL_SNAPSHOT,
      isCycleActive: true,
      consecutiveUnclosedCycles: 3,
    };

    expect(
      buildSyncAttemptStartedPatch('background_task', 1710000000000, previous)
        .consecutiveUnclosedCycles,
    ).toBe(4);
    expect(
      buildSyncAttemptSucceededPatch('background_task', 1710000005000, 1)
        .consecutiveUnclosedCycles,
    ).toBe(0);
  });

  it('resets to zero once a cycle fails', () => {
    expect(
      buildSyncAttemptFailedPatch('background_task', 1710000009000, 'Sync failed')
        .consecutiveUnclosedCycles,
    ).toBe(0);
  });
});

describe('reported stage and error vocabularies stay pinned to the bridge mirror (D4)', () => {
  // A golden membership test, not a behavioural one: it exists so an edit to either array is
  // LOUD (this test breaks) instead of silently drifting from `vocabulary.go`, which this repo
  // cannot read at test time (the EAS container mounts only this repository).
  it('SYNC_CYCLE_STAGES keeps its exact eleven-member vocabulary', () => {
    expect(SYNC_CYCLE_STAGES).toEqual([
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

  it('SYNC_CYCLE_ERROR_NAMES keeps its exact six-member vocabulary', () => {
    expect(SYNC_CYCLE_ERROR_NAMES).toEqual([
      'LocalWriteError',
      'BridgeTimeoutError',
      'BridgeUnreachableError',
      'ReconcileHttpError',
      'SchemaValidationError',
      'unknown',
    ]);
  });

  it('SYNC_CYCLE_ERROR_STAGES keeps its exact six-member vocabulary', () => {
    expect(SYNC_CYCLE_ERROR_STAGES).toEqual([
      'begin',
      'task',
      'commit',
      'rollback',
      'deadline',
      'unknown',
    ]);
  });
});

describe('column semantics that the whole runtime-status mapping rests on', () => {
  // These two helpers centralise the operator choice for EVERY optional column, so a single
  // "simplification" here silently rewrites the meaning of the entire table. Both were measured
  // as unpinned: mutating `??` to `||` and `=== undefined` to `== null` left all 844 tests green.
  // These are the tests that make the two mutations die.

  it('withColumnDefault keeps a legitimate 0 or false instead of replacing it', () => {
    // The mutation this kills is `??` -> `||`. `0` and `false` are real persisted values here
    // (counters, flags); a falsy check would swap each of them for the neutral default and the
    // snapshot would report activity that never happened.
    expect(withColumnDefault(0, 5)).toBe(0);
    expect(withColumnDefault(false, true)).toBe(false);
    expect(withColumnDefault('', 'fallback')).toBe('');
  });

  it('withColumnDefault falls back only for an absent value', () => {
    expect(withColumnDefault(null, 5)).toBe(5);
    expect(withColumnDefault(undefined, 5)).toBe(5);
  });

  it('withPatchOverride preserves an explicit null so a column can be cleared', () => {
    // The mutation this kills is `=== undefined` -> `== null` (or `??`). An explicit `null` in a
    // patch means "clear this column" -- that is how "no error this cycle" is representable. A
    // nullish check would read it as "field not mentioned" and keep the stale previous error
    // forever, so a recovered cycle would still report the failure that preceded it.
    expect(withPatchOverride(null, 'previous error')).toBeNull();
  });

  it('withPatchOverride keeps the current value only when the field is absent', () => {
    expect(withPatchOverride(undefined, 'previous error')).toBe('previous error');
    expect(withPatchOverride('new error', 'previous error')).toBe('new error');
  });
});

describe('a terminal sync attempt releases the cycle-active flag (regression: 2026-09-21 device defect)', () => {
  // Regression coverage for the measured device defect: with the bridge unreachable, a cycle
  // whose terminal state was recorded left `is_cycle_active` set, so every LATER attempt was
  // counted as unclosed (observed 0 -> 1 -> 2) and the acceptance metric
  // "`consecutive_unclosed_cycles` stays 0 for 24 h with the app closed" broke. These tests
  // drive the REAL helper stack (`node:sqlite` adapter + project migrations) through the exact
  // write sequence a headless cycle performs, so the flag bookkeeping is exercised the way the
  // device exercises it rather than against a mocked snapshot. An explicit
  // `recordCycleActive(false)` still appears in the real cycle's finally -- its absence here is
  // the point: the terminal write alone must close the cycle.

  /** Replays the status writes a headless cycle performs from start to a terminal outcome. */
  async function recordCycleFromStartToTerminal(
    adapter: SQLiteDatabase,
    cycleId: string,
    terminal: 'success' | 'failure',
  ): Promise<void> {
    await recordSyncAttemptStarted(adapter, 'background_task', 1710000000000, cycleId);
    await recordCycleActive(adapter, true);

    if (terminal === 'success') {
      await recordSyncAttemptSucceeded(adapter, 'background_task', 1710000001000, 3, cycleId);
    } else {
      await recordSyncAttemptFailed(
        adapter,
        'background_task',
        1710000001000,
        'Network Error',
        {
          cycleId,
          stage: null,
          errorName: 'BridgeUnreachableError',
          errorStage: null,
          nativeErrcodeByte: null,
        },
      );
    }
  }

  /** Opens one migrated, repaired adapter -- the schema shape an installed device has. */
  async function openAdapter(): Promise<SQLiteDatabase> {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await runMigrations(adapter);

    return adapter;
  }

  it('a failed cycle leaves is_cycle_active false, so the next started cycle is not counted as unclosed', async () => {
    const adapter = await openAdapter();

    await recordCycleFromStartToTerminal(adapter, 'cycle-1', 'failure');

    const afterFailure = await getSyncRuntimeStatusSnapshot(adapter);
    expect(afterFailure.isCycleActive).toBe(false);
    expect(afterFailure.consecutiveUnclosedCycles).toBe(0);

    await recordSyncAttemptStarted(adapter, 'background_task', 1710000002000, 'cycle-2');
    await recordSyncAttemptFailed(adapter, 'background_task', 1710000003000, 'Network Error');

    const afterSecondCycle = await getSyncRuntimeStatusSnapshot(adapter);
    expect(afterSecondCycle.isCycleActive).toBe(false);
    expect(afterSecondCycle.consecutiveUnclosedCycles).toBe(0);
  });

  it('a succeeded cycle leaves is_cycle_active false too, so a later start is not counted as unclosed either', async () => {
    const adapter = await openAdapter();

    await recordCycleFromStartToTerminal(adapter, 'cycle-1', 'success');

    const afterSuccess = await getSyncRuntimeStatusSnapshot(adapter);
    expect(afterSuccess.isCycleActive).toBe(false);
    expect(afterSuccess.consecutiveUnclosedCycles).toBe(0);

    await recordSyncAttemptStarted(adapter, 'background_task', 1710000002000, 'cycle-2');
    await recordSyncAttemptFailed(adapter, 'background_task', 1710000003000, 'Network Error');

    const afterSecondCycle = await getSyncRuntimeStatusSnapshot(adapter);
    expect(afterSecondCycle.isCycleActive).toBe(false);
    expect(afterSecondCycle.consecutiveUnclosedCycles).toBe(0);
  });
});

describe('buildCycleBookkeepingPatch folds flush and convergence counters into the single write recordBacklogReadCount already performs (D6)', () => {
  const DIAGNOSTICS_FLUSH: SyncDiagnosticsFlushResult = {
    attempted: 4,
    delivered: 1,
    discarded: 2,
    failedRemovals: 1,
    // Distinct from `discarded` on purpose: 2 / 3 / 4 / 5, so a shared column cannot pass.
    undeliverable: 3,
    unclassified: 4,
    reaped: 5,
  };

  const CONVERGENCE: OperationLogConvergence = {
    deadLetterCount: 3,
    conflictExhaustedCount: 1,
    stuckProcessingCount: 2,
    oldestPendingAgeMs: 5_000,
    pendingRowCount: 210,
    hasMore: true,
  };

  it('folds the backlog read count, the flush counters, the outbox write-failure count and the convergence projection into one patch', () => {
    // CONTRACT UPDATE: the stored shape gains the counters the flush result already carried.
    expect(buildCycleBookkeepingPatch(5, DIAGNOSTICS_FLUSH, 3, CONVERGENCE)).toEqual({
      lastBacklogReadCount: 5,
      lastDiagnosticsDiscardedCount: 2,
      lastDiagnosticsUndeliverableCount: 3,
      lastDiagnosticsUnclassifiedCount: 4,
      lastDiagnosticsReapedCount: 5,
      lastDiagnosticsFailedRemovalCount: 1,
      lastOutboxFailedWriteCount: 3,
      lastDeadLetterCount: 3,
      lastConflictExhaustedCount: 1,
      lastStuckProcessingCount: 2,
      lastOldestPendingAgeMs: 5_000,
      lastPendingRowCount: 210,
    });
  });

  it('persists a null oldest-pending age rather than fabricating zero when the queue is empty (D7)', () => {
    const emptyQueueConvergence: OperationLogConvergence = {
      deadLetterCount: 0,
      conflictExhaustedCount: 0,
      stuckProcessingCount: 0,
      oldestPendingAgeMs: null,
      pendingRowCount: 0,
      hasMore: false,
    };

    expect(
      buildCycleBookkeepingPatch(0, DIAGNOSTICS_FLUSH, 0, emptyQueueConvergence).lastOldestPendingAgeMs,
    ).toBeNull();
  });

  it('folds undeliverable into its own field without conflating it with discarded', () => {
    const patch = buildCycleBookkeepingPatch(1, DIAGNOSTICS_FLUSH, 0, CONVERGENCE);
    expect(patch.lastDiagnosticsUndeliverableCount).toBe(3);
    expect(patch.lastDiagnosticsDiscardedCount).toBe(2);
    expect(patch.lastDiagnosticsReapedCount).toBe(5);
  });

  it('folds unclassified into its own field without conflating it with discarded', () => {
    const patch = buildCycleBookkeepingPatch(1, DIAGNOSTICS_FLUSH, 0, CONVERGENCE);
    expect(patch.lastDiagnosticsUnclassifiedCount).toBe(4);
    expect(patch.lastDiagnosticsDiscardedCount).toBe(2);
    expect(patch.lastDiagnosticsReapedCount).toBe(5);
  });

  it('persists every counter into the singleton row through the migrated schema', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await runMigrations(adapter);
    await recordBacklogReadCount(adapter, 5, DIAGNOSTICS_FLUSH, 0, CONVERGENCE);
    const stored = await getSyncRuntimeStatusSnapshot(adapter);

    expect(stored.lastDiagnosticsDiscardedCount).toBe(2);
    expect(stored.lastDiagnosticsUndeliverableCount).toBe(3);
    expect(stored.lastDiagnosticsUnclassifiedCount).toBe(4);
    // The AGE BOUND's own column: persisted by `0015` (fresh install) and the repair twin (installed
    // device) on this same write, and still separate from `discarded`.
    expect(stored.lastDiagnosticsReapedCount).toBe(5);
  });
});
