import { eq } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { syncRuntimeStatus, type SyncRuntimeStatusRow } from '../../infrastructure/db/schema';
import { SYNC_RUNTIME_STATUS_SINGLETON_ID } from './sync-runtime-status.constants';
import {
  buildCycleActivePatch,
  buildCycleBookkeepingPatch,
  buildPrunedOperationsCountPatch,
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
} from './sync-runtime-status-patch.helpers';
import type { SyncDiagnosticsFlushResult } from './sync-diagnostics-flush.types';
import type { OperationLogConvergence } from './operation-log-convergence.types';
import type {
  SyncAttemptFailureDetail,
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
  SyncRuntimeTriggerSource,
} from './sync-runtime-status.types';

/**
 * Applies the neutral fallback for a persisted column value using nullish coalescing, so a
 * legitimate `0` (or `false`) survives instead of being replaced the way `||` would.
 * Factored out so the per-column mapping below reads as a flat list of calls -- with no `??`
 * of its own, that mapping stays a single, unbranched path.
 */
export function withColumnDefault<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

/**
 * Maps a persisted runtime-status row into its snapshot shape, applying the neutral default
 * for every optional column. Extracted from `getSyncRuntimeStatusSnapshot` so the per-column
 * default tail does not inflate that function's own complexity budget. Exported so
 * `useBackgroundSyncStatus` maps its own live-query row through the SAME defaults instead of
 * duplicating this per-column tail (`bun run audit` flagged the duplicate).
 */
export function mapSyncRuntimeStatusRowToSnapshot(row: SyncRuntimeStatusRow): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: row.registrationStatus,
    executionMode: row.executionMode,
    isForegroundServiceRunning: row.isForegroundServiceRunning,
    canShowPersistentNotification: row.canShowPersistentNotification,
    lastAttemptAt: withColumnDefault(row.lastAttemptAt, null),
    lastSuccessAt: withColumnDefault(row.lastSuccessAt, null),
    lastFailureMessage: withColumnDefault(row.lastFailureMessage, null),
    lastTriggerSource: withColumnDefault(row.lastTriggerSource, null),
    lastSyncedCount: withColumnDefault(row.lastSyncedCount, 0),
    isCycleActive: withColumnDefault(row.isCycleActive, false),
    lastBacklogReadCount: withColumnDefault(row.lastBacklogReadCount, 0),
    lastPrunedOperationsCount: withColumnDefault(row.lastPrunedOperationsCount, 0),
    isBackgroundTaskRegistered: withColumnDefault(row.isBackgroundTaskRegistered, false),
    lastCycleId: withColumnDefault(row.lastCycleId, null),
    lastCycleStage: withColumnDefault(row.lastCycleStage, null),
    lastErrorName: withColumnDefault(row.lastErrorName, null),
    lastNativeErrcodeByte: withColumnDefault(row.lastNativeErrcodeByte, null),
    lastErrorStage: withColumnDefault(row.lastErrorStage, null),
    consecutiveUnclosedCycles: withColumnDefault(row.consecutiveUnclosedCycles, 0),
    lastCycleStageAt: withColumnDefault(row.lastCycleStageAt, null),
    lastFailedCheckpointCount: withColumnDefault(row.lastFailedCheckpointCount, 0),
    // `?? null`, not `?? 0`: a NULL here means "never measured", which is not the same fact as
    // "measured zero" (design.md Decision 7).
    lastDiagnosticsDiscardedCount: withColumnDefault(row.lastDiagnosticsDiscardedCount, null),
    lastDiagnosticsFailedRemovalCount: withColumnDefault(
      row.lastDiagnosticsFailedRemovalCount,
      null,
    ),
    lastOutboxFailedWriteCount: withColumnDefault(row.lastOutboxFailedWriteCount, null),
    lastDeadLetterCount: withColumnDefault(row.lastDeadLetterCount, null),
    lastConflictExhaustedCount: withColumnDefault(row.lastConflictExhaustedCount, null),
    lastStuckProcessingCount: withColumnDefault(row.lastStuckProcessingCount, null),
    lastOldestPendingAgeMs: withColumnDefault(row.lastOldestPendingAgeMs, null),
    lastPendingRowCount: withColumnDefault(row.lastPendingRowCount, null),
  };
}

/**
 * Reads the persisted singleton runtime snapshot from SQLite.
 * When no row exists yet, the neutral snapshot is returned instead.
 */
export async function getSyncRuntimeStatusSnapshot(
  rawDb: SQLiteDatabase,
): Promise<SyncRuntimeStatusSnapshot> {
  const db = createDrizzleDb(rawDb);
  const [row] = await db
    .select()
    .from(syncRuntimeStatus)
    .where(eq(syncRuntimeStatus.id, SYNC_RUNTIME_STATUS_SINGLETON_ID))
    .limit(1);

  return row ? mapSyncRuntimeStatusRowToSnapshot(row) : createEmptySyncRuntimeStatusSnapshot();
}

/**
 * Applies a patch field that may deliberately clear a value to `null`. Unlike
 * `withColumnDefault`, an explicit `null` in the patch is preserved as-is; only `undefined`
 * (the field was not mentioned) falls back to the current value. This is what makes "no error
 * this cycle" representable -- `??` would silently treat that `null` as absent instead.
 */
export function withPatchOverride<T>(patchValue: T | null | undefined, currentValue: T | null): T | null {
  return patchValue === undefined ? currentValue : patchValue;
}

/**
 * Merges a runtime-status patch onto the current snapshot, one column at a time. Extracted
 * from `persistSyncRuntimeStatusPatch` so the per-column merge tail does not inflate that
 * function's own complexity budget.
 */
function mergeSyncRuntimeStatusPatch(
  current: SyncRuntimeStatusSnapshot,
  patch: SyncRuntimeStatusPatch,
): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: withColumnDefault(patch.registrationStatus, current.registrationStatus),
    executionMode: withColumnDefault(patch.executionMode, current.executionMode),
    isForegroundServiceRunning: withColumnDefault(
      patch.isForegroundServiceRunning,
      current.isForegroundServiceRunning,
    ),
    canShowPersistentNotification: withColumnDefault(
      patch.canShowPersistentNotification,
      current.canShowPersistentNotification,
    ),
    lastAttemptAt: withPatchOverride(patch.lastAttemptAt, current.lastAttemptAt),
    lastSuccessAt: withPatchOverride(patch.lastSuccessAt, current.lastSuccessAt),
    lastFailureMessage: withPatchOverride(patch.lastFailureMessage, current.lastFailureMessage),
    lastTriggerSource: withPatchOverride(patch.lastTriggerSource, current.lastTriggerSource),
    lastSyncedCount: withColumnDefault(patch.lastSyncedCount, current.lastSyncedCount),
    isCycleActive: withColumnDefault(patch.isCycleActive, current.isCycleActive),
    lastBacklogReadCount: withColumnDefault(patch.lastBacklogReadCount, current.lastBacklogReadCount),
    lastPrunedOperationsCount: withColumnDefault(
      patch.lastPrunedOperationsCount,
      current.lastPrunedOperationsCount,
    ),
    isBackgroundTaskRegistered: withColumnDefault(
      patch.isBackgroundTaskRegistered,
      current.isBackgroundTaskRegistered,
    ),
    // Nullable columns use `withPatchOverride` rather than `withColumnDefault`: a patch that
    // deliberately CLEARS a field to null must survive, and a nullish-coalescing default would
    // silently fall through to the current value instead, making "no error this cycle" unrepresentable.
    lastCycleId: withPatchOverride(patch.lastCycleId, current.lastCycleId),
    lastCycleStage: withPatchOverride(patch.lastCycleStage, current.lastCycleStage),
    lastErrorName: withPatchOverride(patch.lastErrorName, current.lastErrorName),
    lastNativeErrcodeByte: withPatchOverride(patch.lastNativeErrcodeByte, current.lastNativeErrcodeByte),
    lastErrorStage: withPatchOverride(patch.lastErrorStage, current.lastErrorStage),
    consecutiveUnclosedCycles: withColumnDefault(
      patch.consecutiveUnclosedCycles,
      current.consecutiveUnclosedCycles,
    ),
    lastCycleStageAt: withPatchOverride(patch.lastCycleStageAt, current.lastCycleStageAt),
    lastFailedCheckpointCount: withColumnDefault(
      patch.lastFailedCheckpointCount,
      current.lastFailedCheckpointCount,
    ),
    // `withPatchOverride`, not `withColumnDefault`: `lastOldestPendingAgeMs` in particular can be
    // a legitimate `null` at write time (an empty queue), and `??` would silently fall back to
    // the previous cycle's value instead of persisting that fresh, honest `null`.
    lastDiagnosticsDiscardedCount: withPatchOverride(
      patch.lastDiagnosticsDiscardedCount,
      current.lastDiagnosticsDiscardedCount,
    ),
    lastDiagnosticsFailedRemovalCount: withPatchOverride(
      patch.lastDiagnosticsFailedRemovalCount,
      current.lastDiagnosticsFailedRemovalCount,
    ),
    lastOutboxFailedWriteCount: withPatchOverride(
      patch.lastOutboxFailedWriteCount,
      current.lastOutboxFailedWriteCount,
    ),
    lastDeadLetterCount: withPatchOverride(patch.lastDeadLetterCount, current.lastDeadLetterCount),
    lastConflictExhaustedCount: withPatchOverride(
      patch.lastConflictExhaustedCount,
      current.lastConflictExhaustedCount,
    ),
    lastStuckProcessingCount: withPatchOverride(
      patch.lastStuckProcessingCount,
      current.lastStuckProcessingCount,
    ),
    lastOldestPendingAgeMs: withPatchOverride(
      patch.lastOldestPendingAgeMs,
      current.lastOldestPendingAgeMs,
    ),
    lastPendingRowCount: withPatchOverride(patch.lastPendingRowCount, current.lastPendingRowCount),
  };
}

/**
 * Writes the merged runtime-status snapshot into the singleton row via upsert. Extracted from
 * `persistSyncRuntimeStatusPatch` so that function's own line count and complexity stay within
 * budget; the insert and update columns are built once and shared between both clauses.
 */
async function writeSyncRuntimeStatusRow(
  rawDb: SQLiteDatabase,
  next: SyncRuntimeStatusSnapshot,
): Promise<void> {
  const columns = {
    registrationStatus: next.registrationStatus,
    executionMode: next.executionMode,
    isForegroundServiceRunning: next.isForegroundServiceRunning,
    canShowPersistentNotification: next.canShowPersistentNotification,
    lastAttemptAt: next.lastAttemptAt,
    lastSuccessAt: next.lastSuccessAt,
    lastFailureMessage: next.lastFailureMessage,
    lastTriggerSource: next.lastTriggerSource,
    lastSyncedCount: next.lastSyncedCount,
    isCycleActive: next.isCycleActive,
    lastBacklogReadCount: next.lastBacklogReadCount,
    lastPrunedOperationsCount: next.lastPrunedOperationsCount,
    isBackgroundTaskRegistered: next.isBackgroundTaskRegistered,
    lastCycleId: next.lastCycleId,
    lastCycleStage: next.lastCycleStage,
    lastErrorName: next.lastErrorName,
    lastNativeErrcodeByte: next.lastNativeErrcodeByte,
    lastErrorStage: next.lastErrorStage,
    consecutiveUnclosedCycles: next.consecutiveUnclosedCycles,
    lastCycleStageAt: next.lastCycleStageAt,
    lastFailedCheckpointCount: next.lastFailedCheckpointCount,
    lastDiagnosticsDiscardedCount: next.lastDiagnosticsDiscardedCount,
    lastDiagnosticsFailedRemovalCount: next.lastDiagnosticsFailedRemovalCount,
    lastOutboxFailedWriteCount: next.lastOutboxFailedWriteCount,
    lastDeadLetterCount: next.lastDeadLetterCount,
    lastConflictExhaustedCount: next.lastConflictExhaustedCount,
    lastStuckProcessingCount: next.lastStuckProcessingCount,
    lastOldestPendingAgeMs: next.lastOldestPendingAgeMs,
    lastPendingRowCount: next.lastPendingRowCount,
  };

  await withLocalWrite(rawDb, async (db) => {
    await db
      .insert(syncRuntimeStatus)
      .values({ id: SYNC_RUNTIME_STATUS_SINGLETON_ID, ...columns })
      .onConflictDoUpdate({
        target: syncRuntimeStatus.id,
        set: columns,
      });
  });
}

/**
 * Read-modify-write of the singleton runtime row, so callers can patch one field without
 * restating the rest. The full snapshot is rebuilt before writing because the row is an upsert:
 * a partial `values()` would reset every column the caller did not mention.
 */
async function persistSyncRuntimeStatusPatch(
  rawDb: SQLiteDatabase,
  patch: SyncRuntimeStatusPatch,
): Promise<void> {
  const current = await getSyncRuntimeStatusSnapshot(rawDb);
  const next = mergeSyncRuntimeStatusPatch(current, patch);

  await writeSyncRuntimeStatusRow(rawDb, next);
}

/**
 * Persists an arbitrary runtime snapshot patch into the singleton observable row.
 * Runtime wiring uses this to reflect registration changes even outside a sync attempt lifecycle.
 */
export async function updateSyncRuntimeStatusSnapshot(
  rawDb: SQLiteDatabase,
  patch: SyncRuntimeStatusPatch,
) {
  await persistSyncRuntimeStatusPatch(rawDb, patch);
}

/**
 * Persists the start of a sync attempt into the runtime snapshot singleton.
 *
 * This records the latest trigger source and clears any stale visible failure. The pre-cycle
 * snapshot is read here (a second read beyond `persistSyncRuntimeStatusPatch`'s own) because
 * `buildSyncAttemptStartedPatch` needs it BEFORE this cycle's write overwrites the very fields
 * `consecutiveUnclosedCycles` depends on -- the two reads stay outside `withLocalWrite`, so this
 * costs no extra transaction on the shared write door. `cycleId` is optional: a caller outside
 * the headless cycle's stage machine has none to correlate.
 */
export async function recordSyncAttemptStarted(
  rawDb: SQLiteDatabase,
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  cycleId: string | null = null,
) {
  const previous = await getSyncRuntimeStatusSnapshot(rawDb);

  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptStartedPatch(triggerSource, attemptedAt, previous, cycleId),
  );
}

/**
 * Persists a successful sync attempt and the confirmed operations count.
 * This is the source used by Settings to report the latest healthy background cycle.
 */
export async function recordSyncAttemptSucceeded(
  rawDb: SQLiteDatabase,
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  syncedCount: number,
  cycleId: string | null = null,
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptSucceededPatch(triggerSource, attemptedAt, syncedCount, cycleId),
  );
}

/**
 * Persists a failed sync attempt without fabricating a success timestamp.
 * The failure message is intentionally surfaced later in the Settings diagnostics card.
 */
export async function recordSyncAttemptFailed(
  rawDb: SQLiteDatabase,
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  message: string,
  detail: SyncAttemptFailureDetail = {},
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptFailedPatch(triggerSource, attemptedAt, message, detail),
  );
}

/**
 * Persists whether a sync cycle is currently active.
 * Headless cycles toggle this around reconcile and pruning so the UI reflects live work.
 */
export async function recordCycleActive(rawDb: SQLiteDatabase, isActive: boolean) {
  await persistSyncRuntimeStatusPatch(rawDb, buildCycleActivePatch(isActive));
}

/**
 * Persists one cycle's post-reconcile bookkeeping: the bounded backlog read size, the
 * diagnostics-outbox flush and write-failure counters, and the operation-log convergence
 * projection, all folded into the SAME read-modify-write this function already performed before
 * `2026-09-09-convergence-instrumentation` widened it (design.md Decision 6) -- the write door
 * gains zero new transactions.
 */
export async function recordBacklogReadCount(
  rawDb: SQLiteDatabase,
  backlogReadCount: number,
  diagnosticsFlush: SyncDiagnosticsFlushResult,
  outboxFailedWriteCount: number,
  convergence: OperationLogConvergence,
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildCycleBookkeepingPatch(backlogReadCount, diagnosticsFlush, outboxFailedWriteCount, convergence),
  );
}

/**
 * Persists the number of terminal operation-log rows pruned in the latest cycle.
 * This lets Settings show how much history was reclaimed by retention rules.
 */
export async function recordPrunedOperationsCount(rawDb: SQLiteDatabase, count: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildPrunedOperationsCountPatch(count));
}
