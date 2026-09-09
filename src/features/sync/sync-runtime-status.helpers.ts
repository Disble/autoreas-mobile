import { eq } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { syncRuntimeStatus, type SyncRuntimeStatusRow } from '../../infrastructure/db/schema';
import {
  DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  SYNC_RUNTIME_STATUS_SINGLETON_ID,
} from './sync-runtime-status.constants';
import type {
  SyncAttemptFailureDetail,
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
  SyncRuntimeTriggerSource,
} from './sync-runtime-status.types';

/**
 * Creates the neutral runtime snapshot used before any observable sync activity exists.
 * Tests and UI both rely on this to avoid duplicating default-state assumptions.
 */
export function createEmptySyncRuntimeStatusSnapshot(): SyncRuntimeStatusSnapshot {
  return DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT;
}

/**
 * Builds the snapshot patch for the start of a sync attempt.
 *
 * Starting a cycle always clears the previous failure and records the current trigger source,
 * and now also records this cycle's identity, marks its stage `attempt_started`, and CLEARS the
 * error triple to explicit `null` -- without that clear a three-cycle-old error would keep being
 * reported as the previous cycle's. `consecutiveUnclosedCycles` is derived purely from
 * `previous`: it increments when the prior cycle never released `isCycleActive` (it started but
 * never closed) and resets to zero otherwise. `cycleId` defaults to `null` because a caller
 * outside the headless cycle's stage machine has no cycle identity to correlate.
 */
export function buildSyncAttemptStartedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  previous: SyncRuntimeStatusSnapshot,
  cycleId: string | null = null,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
    lastCycleId: cycleId,
    lastCycleStage: 'attempt_started',
    lastCycleStageAt: attemptedAt,
    lastErrorName: null,
    lastErrorStage: null,
    lastNativeErrcodeByte: null,
    consecutiveUnclosedCycles: previous.isCycleActive
      ? previous.consecutiveUnclosedCycles + 1
      : 0,
  };
}

/**
 * Builds the snapshot patch for a successful sync cycle.
 *
 * Success records both the latest attempt timestamp and how many operations were confirmed, and
 * now also marks the stage `closed`, CLEARS the error triple to explicit `null` (Requirement:
 * "A succeeded cycle clears the previous error detail"), and resets `consecutiveUnclosedCycles`
 * -- a success closes the cycle it belongs to.
 */
export function buildSyncAttemptSucceededPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  syncedCount: number,
  cycleId: string | null = null,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastSuccessAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
    lastSyncedCount: syncedCount,
    lastCycleId: cycleId,
    lastCycleStage: 'closed',
    lastCycleStageAt: attemptedAt,
    lastErrorName: null,
    lastErrorStage: null,
    lastNativeErrcodeByte: null,
    consecutiveUnclosedCycles: 0,
  };
}

/**
 * Builds the snapshot patch for a failed sync cycle.
 *
 * Failures keep the last success intact while exposing the current error to Settings, and now
 * also record the stage and classified error the cycle failed with (Requirement: "A failed
 * cycle records the stage and error it failed with"). Every `detail` field defaults to `null`:
 * a caller that cannot classify where or why the cycle failed reports that honestly rather than
 * fabricating a stage or error class. A failure also closes the cycle, so
 * `consecutiveUnclosedCycles` resets to zero.
 */
export function buildSyncAttemptFailedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  message: string,
  detail: SyncAttemptFailureDetail = {},
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: message,
    lastTriggerSource: triggerSource,
    lastCycleId: detail.cycleId ?? null,
    lastCycleStage: detail.stage ?? null,
    lastCycleStageAt: attemptedAt,
    lastErrorName: detail.errorName ?? null,
    lastErrorStage: detail.errorStage ?? null,
    lastNativeErrcodeByte: detail.nativeErrcodeByte ?? null,
    consecutiveUnclosedCycles: 0,
  };
}

/**
 * Builds the snapshot patch that marks a sync cycle as active or inactive.
 * This lets Settings distinguish an idle runtime from one that is mid-cycle.
 */
function buildCycleActivePatch(isActive: boolean): SyncRuntimeStatusPatch {
  return {
    isCycleActive: isActive,
  };
}

/**
 * Builds the snapshot patch for the latest bounded backlog read size.
 * Bounded reads keep this metric honest without materializing the whole queue.
 */
function buildBacklogReadCountPatch(count: number): SyncRuntimeStatusPatch {
  return {
    lastBacklogReadCount: count,
  };
}

/**
 * Builds the snapshot patch for the latest operation-log prune result.
 * This exposes how much terminal history was reclaimed by TTL or max-count rules.
 */
function buildPrunedOperationsCountPatch(count: number): SyncRuntimeStatusPatch {
  return {
    lastPrunedOperationsCount: count,
  };
}

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
 * default tail does not inflate that function's own complexity budget.
 */
function mapSyncRuntimeStatusRowToSnapshot(row: SyncRuntimeStatusRow): SyncRuntimeStatusSnapshot {
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
 * Persists the size of the latest bounded backlog read.
 * This metric is updated before reconcile runs so it matches the actual batch size.
 */
export async function recordBacklogReadCount(rawDb: SQLiteDatabase, count: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildBacklogReadCountPatch(count));
}

/**
 * Persists the number of terminal operation-log rows pruned in the latest cycle.
 * This lets Settings show how much history was reclaimed by retention rules.
 */
export async function recordPrunedOperationsCount(rawDb: SQLiteDatabase, count: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildPrunedOperationsCountPatch(count));
}
