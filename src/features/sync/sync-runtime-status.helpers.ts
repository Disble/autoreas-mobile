import { eq } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { syncRuntimeStatus, type SyncRuntimeStatusRow } from '../../infrastructure/db/schema';
import { SYNC_RUNTIME_STATUS_SINGLETON_ID } from './sync-runtime-status.constants';
import {
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
} from './sync-runtime-status-patch.helpers';
import type {
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
} from './sync-runtime-status.types';

/**
 * Applies the neutral fallback for a persisted column value using nullish coalescing, so a
 * legitimate `0` (or `false`) survives instead of being replaced the way `||` would.
 */
export function withColumnDefault<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

/**
 * Maps a persisted runtime-status row into its snapshot shape, applying the neutral default
 * for every optional column. Exported so `useBackgroundSyncStatus` maps its own live-query row
 * through the SAME defaults instead of duplicating this per-column tail.
 */
export function mapSyncRuntimeStatusRowToSnapshot(row: SyncRuntimeStatusRow): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: row.registrationStatus,
    executionMode: row.executionMode,
    canShowPersistentNotification: row.canShowPersistentNotification,
    lastAttemptAt: withColumnDefault(row.lastAttemptAt, null),
    lastSuccessAt: withColumnDefault(row.lastSuccessAt, null),
    lastCycleId: withColumnDefault(row.lastCycleId, null),
    lastCycleStage: withColumnDefault(row.lastCycleStage, null),
    lastErrorName: withColumnDefault(row.lastErrorName, null),
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

/** Merges a runtime-status patch onto the current snapshot, one column at a time. */
function mergeSyncRuntimeStatusPatch(
  current: SyncRuntimeStatusSnapshot,
  patch: SyncRuntimeStatusPatch,
): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: withColumnDefault(patch.registrationStatus, current.registrationStatus),
    executionMode: withColumnDefault(patch.executionMode, current.executionMode),
    canShowPersistentNotification: withColumnDefault(
      patch.canShowPersistentNotification,
      current.canShowPersistentNotification,
    ),
    // Nullable columns use `withPatchOverride` rather than `withColumnDefault`: a patch that
    // deliberately CLEARS a field to null must survive, and a nullish-coalescing default would
    // silently fall through to the current value instead.
    lastAttemptAt: withPatchOverride(patch.lastAttemptAt, current.lastAttemptAt),
    lastSuccessAt: withPatchOverride(patch.lastSuccessAt, current.lastSuccessAt),
    lastCycleId: withPatchOverride(patch.lastCycleId, current.lastCycleId),
    lastCycleStage: withPatchOverride(patch.lastCycleStage, current.lastCycleStage),
    lastErrorName: withPatchOverride(patch.lastErrorName, current.lastErrorName),
  };
}

/**
 * Writes the merged runtime-status snapshot into the singleton row via upsert; the insert and
 * update columns are built once and shared between both clauses.
 */
async function writeSyncRuntimeStatusRow(
  rawDb: SQLiteDatabase,
  next: SyncRuntimeStatusSnapshot,
): Promise<void> {
  const columns = { ...next };

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

/** Persists the start of a sync attempt into the runtime snapshot singleton. */
export async function recordSyncAttemptStarted(rawDb: SQLiteDatabase, attemptedAt: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildSyncAttemptStartedPatch(attemptedAt));
}

/**
 * Persists a successful sync attempt. Its success instant is the reachability evidence the
 * status facade reads (ADR 009 R-9).
 */
export async function recordSyncAttemptSucceeded(rawDb: SQLiteDatabase, attemptedAt: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildSyncAttemptSucceededPatch(attemptedAt));
}

/** Persists a failed sync attempt without fabricating a success timestamp. */
export async function recordSyncAttemptFailed(rawDb: SQLiteDatabase, attemptedAt: number) {
  await persistSyncRuntimeStatusPatch(rawDb, buildSyncAttemptFailedPatch(attemptedAt));
}
