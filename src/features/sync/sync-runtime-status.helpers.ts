import { eq } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createDrizzleDb, withDeferredWrite } from '../../infrastructure/db/client';
import { syncRuntimeStatus } from '../../infrastructure/db/schema';
import {
  DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  SYNC_RUNTIME_STATUS_SINGLETON_ID,
} from './sync-runtime-status.constants';
import type {
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
 * Starting a cycle always clears the previous failure and records the current trigger source.
 */
export function buildSyncAttemptStartedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
  };
}

/**
 * Builds the snapshot patch for a successful sync cycle.
 * Success records both the latest attempt timestamp and how many operations were confirmed.
 */
export function buildSyncAttemptSucceededPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  syncedCount: number,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastSuccessAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
    lastSyncedCount: syncedCount,
  };
}

/**
 * Builds the snapshot patch for a failed sync cycle.
 * Failures keep the last success intact while exposing the current error to Settings.
 */
export function buildSyncAttemptFailedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  message: string,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: message,
    lastTriggerSource: triggerSource,
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

  if (!row) {
    return createEmptySyncRuntimeStatusSnapshot();
  }

  return {
    registrationStatus: row.registrationStatus,
    executionMode: row.executionMode,
    isForegroundServiceRunning: row.isForegroundServiceRunning,
    canShowPersistentNotification: row.canShowPersistentNotification,
    lastAttemptAt: row.lastAttemptAt ?? null,
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastFailureMessage: row.lastFailureMessage ?? null,
    lastTriggerSource: row.lastTriggerSource ?? null,
    lastSyncedCount: row.lastSyncedCount ?? 0,
  };
}

async function persistSyncRuntimeStatusPatch(
  rawDb: SQLiteDatabase,
  patch: SyncRuntimeStatusPatch,
): Promise<void> {
  const current = await getSyncRuntimeStatusSnapshot(rawDb);
  const next: SyncRuntimeStatusSnapshot = {
    registrationStatus: patch.registrationStatus ?? current.registrationStatus,
    executionMode: patch.executionMode ?? current.executionMode,
    isForegroundServiceRunning:
      patch.isForegroundServiceRunning ?? current.isForegroundServiceRunning,
    canShowPersistentNotification:
      patch.canShowPersistentNotification ?? current.canShowPersistentNotification,
    lastAttemptAt: patch.lastAttemptAt === undefined ? current.lastAttemptAt : patch.lastAttemptAt,
    lastSuccessAt: patch.lastSuccessAt === undefined ? current.lastSuccessAt : patch.lastSuccessAt,
    lastFailureMessage:
      patch.lastFailureMessage === undefined ? current.lastFailureMessage : patch.lastFailureMessage,
    lastTriggerSource:
      patch.lastTriggerSource === undefined ? current.lastTriggerSource : patch.lastTriggerSource,
    lastSyncedCount: patch.lastSyncedCount ?? current.lastSyncedCount,
  };

  await withDeferredWrite(rawDb, async (db) => {
    await db
      .insert(syncRuntimeStatus)
      .values({
        id: SYNC_RUNTIME_STATUS_SINGLETON_ID,
        registrationStatus: next.registrationStatus,
        executionMode: next.executionMode,
        isForegroundServiceRunning: next.isForegroundServiceRunning,
        canShowPersistentNotification: next.canShowPersistentNotification,
        lastAttemptAt: next.lastAttemptAt,
        lastSuccessAt: next.lastSuccessAt,
        lastFailureMessage: next.lastFailureMessage,
        lastTriggerSource: next.lastTriggerSource,
        lastSyncedCount: next.lastSyncedCount,
      })
      .onConflictDoUpdate({
        target: syncRuntimeStatus.id,
        set: {
          registrationStatus: next.registrationStatus,
          executionMode: next.executionMode,
          isForegroundServiceRunning: next.isForegroundServiceRunning,
          canShowPersistentNotification: next.canShowPersistentNotification,
          lastAttemptAt: next.lastAttemptAt,
          lastSuccessAt: next.lastSuccessAt,
          lastFailureMessage: next.lastFailureMessage,
          lastTriggerSource: next.lastTriggerSource,
          lastSyncedCount: next.lastSyncedCount,
        },
      });
  });
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
 * This records the latest trigger source and clears any stale visible failure.
 */
export async function recordSyncAttemptStarted(
  rawDb: SQLiteDatabase,
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptStartedPatch(triggerSource, attemptedAt),
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
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptSucceededPatch(triggerSource, attemptedAt, syncedCount),
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
) {
  await persistSyncRuntimeStatusPatch(
    rawDb,
    buildSyncAttemptFailedPatch(triggerSource, attemptedAt, message),
  );
}
