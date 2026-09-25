import {
  getSyncRuntimeStatusSnapshot,
  recordBacklogReadCount,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import { buildCycleBookkeepingPatch } from '../../../../src/features/sync/sync-runtime-status-patch.helpers';
import type { SyncDiagnosticsFlushResult } from '../../../../src/features/sync/sync-diagnostics-flush.types';
import type { OperationLogConvergence } from '../../../../src/features/sync/operation-log-convergence.types';
import { runMigrations } from '../../../../src/infrastructure/db/client/client.helpers';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../../support/sqlite-adapter.helpers';

// Split out of sync-runtime-status.helpers.test.ts, which crossed the 500-line cap when two
// branches' tests merged. Same wiring as that suite.
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
