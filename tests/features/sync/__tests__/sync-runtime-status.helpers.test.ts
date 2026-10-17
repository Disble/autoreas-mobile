import {
  getSyncRuntimeStatusSnapshot,
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
  updateSyncRuntimeStatusSnapshot,
  withColumnDefault,
  withPatchOverride,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import {
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
} from '../../../../src/features/sync/sync-runtime-status-patch.helpers';
import { SYNC_CYCLE_STAGES } from '../../../../src/features/sync/sync-runtime-status.constants';
import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../../../../src/infrastructure/db/client/client.helpers';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../../support/sqlite-adapter.helpers';

// The ONLY production modules mocked in this suite, and only to hand drizzle a node:sqlite
// handle instead of expo-sqlite -- the same wiring the behaviour suites use. The drizzle
// migrator is a no-op because `applyMigrationFiles` already ran the same SQL; `runMigrations`
// still executes its idempotent repair steps, the route an installed device takes. Everything
// else (write door, singleton upsert, merge semantics) runs for real.
jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** Opens one migrated, repaired adapter -- the schema shape an installed device has. */
async function openAdapter(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await runMigrations(adapter);

  return adapter;
}

describe('sync runtime status patch builders', () => {
  it('createEmptySyncRuntimeStatusSnapshot retorna el snapshot neutral esperado', () => {
    expect(createEmptySyncRuntimeStatusSnapshot()).toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'best_effort_background_task',
      canShowPersistentNotification: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastCycleId: null,
      lastCycleStage: null,
      lastErrorName: null,
    });
  });

  it('buildSyncAttemptStartedPatch registra el intento y limpia el ciclo y el error previos', () => {
    expect(buildSyncAttemptStartedPatch(1710000000000)).toEqual({
      lastAttemptAt: 1710000000000,
      lastCycleId: null,
      lastCycleStage: 'attempt_started',
      lastErrorName: null,
    });
  });

  it('buildSyncAttemptSucceededPatch persiste el éxito junto al intento', () => {
    expect(buildSyncAttemptSucceededPatch(1710000005000)).toEqual({
      lastAttemptAt: 1710000005000,
      lastSuccessAt: 1710000005000,
      lastCycleId: null,
      lastCycleStage: 'closed',
      lastErrorName: null,
    });
  });

  it('buildSyncAttemptFailedPatch persiste el intento sin inventar éxito ni etapa', () => {
    expect(buildSyncAttemptFailedPatch(1710000009000)).toEqual({
      lastAttemptAt: 1710000009000,
      lastCycleId: null,
      lastCycleStage: null,
      lastErrorName: null,
    });
  });

  it('SYNC_CYCLE_STAGES names exactly the two checkpoints the JS cycle records', () => {
    expect(SYNC_CYCLE_STAGES).toEqual(['attempt_started', 'closed']);
  });
});

describe('column semantics that the whole runtime-status mapping rests on', () => {
  // These two helpers centralise the operator choice for EVERY optional column, so a single
  // "simplification" here silently rewrites the meaning of the entire table. These are the tests
  // that make the `??` -> `||` and `=== undefined` -> `== null` mutations die.

  it('withColumnDefault keeps a legitimate 0 or false instead of replacing it', () => {
    expect(withColumnDefault(0, 5)).toBe(0);
    expect(withColumnDefault(false, true)).toBe(false);
    expect(withColumnDefault('', 'fallback')).toBe('');
  });

  it('withColumnDefault falls back only for an absent value', () => {
    expect(withColumnDefault(null, 5)).toBe(5);
    expect(withColumnDefault(undefined, 5)).toBe(5);
  });

  it('withPatchOverride preserves an explicit null so a column can be cleared', () => {
    // An explicit `null` in a patch means "clear this column" -- that is how "no error this
    // cycle" is representable. A nullish check would keep the stale previous error forever.
    expect(withPatchOverride(null, 'previous error')).toBeNull();
  });

  it('withPatchOverride keeps the current value only when the field is absent', () => {
    expect(withPatchOverride(undefined, 'previous error')).toBe('previous error');
    expect(withPatchOverride('new error', 'previous error')).toBe('new error');
  });
});

describe('the attempt lifecycle persisted through the real write door', () => {
  it('a started then succeeded attempt persists the success instant and closes the stage', async () => {
    const adapter = await openAdapter();

    await recordSyncAttemptStarted(adapter, 1710000000000);
    expect(await getSyncRuntimeStatusSnapshot(adapter)).toEqual(
      expect.objectContaining({
        lastAttemptAt: 1710000000000,
        lastSuccessAt: null,
        lastCycleStage: 'attempt_started',
      }),
    );

    await recordSyncAttemptSucceeded(adapter, 1710000001000);
    expect(await getSyncRuntimeStatusSnapshot(adapter)).toEqual(
      expect.objectContaining({
        lastAttemptAt: 1710000001000,
        lastSuccessAt: 1710000001000,
        lastCycleStage: 'closed',
      }),
    );
  });

  it('a failed attempt keeps the previous success and clears the cycle id and error a native cycle left', async () => {
    const adapter = await openAdapter();
    await recordSyncAttemptSucceeded(adapter, 1710000000000);
    // A native cycle wrote its own identity and error class into the same singleton row.
    await adapter.runAsync(
      "UPDATE sync_runtime_status SET last_cycle_id = 'native-cycle', last_error_name = 'ReconcileHttpError' WHERE id = 1",
    );

    await recordSyncAttemptFailed(adapter, 1710000009000);

    expect(await getSyncRuntimeStatusSnapshot(adapter)).toEqual(
      expect.objectContaining({
        lastAttemptAt: 1710000009000,
        lastSuccessAt: 1710000000000,
        lastCycleId: null,
        lastCycleStage: null,
        lastErrorName: null,
      }),
    );
  });

  it('an attempt never touches the registration columns the execution strategy owns', async () => {
    const adapter = await openAdapter();
    await updateSyncRuntimeStatusSnapshot(adapter, {
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      canShowPersistentNotification: true,
    });

    await recordSyncAttemptStarted(adapter, 1710000000000);
    await recordSyncAttemptSucceeded(adapter, 1710000001000);

    expect(await getSyncRuntimeStatusSnapshot(adapter)).toEqual(
      expect.objectContaining({
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        canShowPersistentNotification: true,
      }),
    );
  });
});
