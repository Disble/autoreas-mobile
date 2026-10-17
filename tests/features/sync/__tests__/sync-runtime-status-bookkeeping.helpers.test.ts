import {
  getSyncRuntimeStatusSnapshot,
  recordSyncAttemptSucceeded,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import { buildSyncAttemptSucceededPatch } from '../../../../src/features/sync/sync-runtime-status-patch.helpers';
import type { SyncDiagnosticsFlushResult } from '../../../../src/features/sync/sync-diagnostics-flush.types';
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

/** One flush result with a distinct value per counter, so a swapped column cannot pass. */
const DIAGNOSTICS_FLUSH: SyncDiagnosticsFlushResult = {
  attempted: 4,
  delivered: 1,
  discarded: 2,
  failedRemovals: 1,
  undeliverable: 3,
  unclassified: 4,
  reaped: 5,
};

describe('a succeeded attempt folds the diagnostics flush counters into its own write', () => {
  it('maps discarded, undeliverable, unclassified and reaped onto their own columns', () => {
    const patch = buildSyncAttemptSucceededPatch('app_active', 1_000, 1, 'cycle-1', DIAGNOSTICS_FLUSH);

    expect(patch.lastDiagnosticsDiscardedCount).toBe(2);
    expect(patch.lastDiagnosticsUndeliverableCount).toBe(3);
    expect(patch.lastDiagnosticsUnclassifiedCount).toBe(4);
    expect(patch.lastDiagnosticsReapedCount).toBe(5);
  });

  it('leaves every counter column out of the patch when the caller holds no flush evidence', () => {
    const patch = buildSyncAttemptSucceededPatch('app_active', 1_000, 1, 'cycle-1');

    expect(patch).not.toHaveProperty('lastDiagnosticsDiscardedCount');
    expect(patch).not.toHaveProperty('lastDiagnosticsUndeliverableCount');
    expect(patch).not.toHaveProperty('lastDiagnosticsUnclassifiedCount');
    expect(patch).not.toHaveProperty('lastDiagnosticsReapedCount');
  });

  it('persists every counter into the singleton row through the migrated schema', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await runMigrations(adapter);
    await recordSyncAttemptSucceeded(adapter, 'app_active', 1_000, 1, 'cycle-1', DIAGNOSTICS_FLUSH);
    const stored = await getSyncRuntimeStatusSnapshot(adapter);

    expect(stored.lastDiagnosticsDiscardedCount).toBe(2);
    expect(stored.lastDiagnosticsUndeliverableCount).toBe(3);
    expect(stored.lastDiagnosticsUnclassifiedCount).toBe(4);
    // The AGE BOUND's own column: persisted by `0015` (fresh install) and the repair twin (installed
    // device) on this same write, and still separate from `discarded`.
    expect(stored.lastDiagnosticsReapedCount).toBe(5);
  });
});
