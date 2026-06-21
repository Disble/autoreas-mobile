import type { SQLiteDatabase } from 'expo-sqlite';
import { withDeferredWrite } from '../../infrastructure/db/client';
import { applyRemoteChanges, loadGuardMap, loadPendingOutboxRecordIds } from './merge';
import {
  deletePendingRemoteChanges,
  loadPendingRemoteChanges,
} from './pending-remote-changes.helpers';

/**
 * Outcome of one drain pass: how the merge boundary classified the staged batch, plus how
 * many staging rows were drained (read + deleted) in this pass.
 */
export interface DrainPendingRemoteChangesResult {
  readonly applied: number;
  readonly dropped: number;
  readonly deferred: number;
  readonly drainedCount: number;
}

/**
 * Applies every currently staged `pending_remote_changes` row to `animes` via the shared
 * merge boundary, on the shared REACTIVE connection (`withDeferredWrite`), so foreground
 * `useLiveQuery` consumers observe the result immediately. This is the only place background
 * sync's writes ever reach `animes` -- the headless cycle itself never writes `animes`
 * directly (see `headless-sync-cycle.helpers.ts` / `syncPendingOperations` staged mode).
 *
 * Drained rows are deleted in the SAME deferred transaction as the apply, so a crash between
 * apply and delete cannot silently lose a change: the next drain pass re-reads and re-applies,
 * and the per-anime staleness guard makes that re-apply a safe no-op for rows already applied.
 *
 * No-ops (does not open a write transaction at all) when there is nothing staged, so a drain
 * triggered on every foreground/resume tick is cheap when idle.
 */
export async function drainPendingRemoteChanges(
  rawDb: SQLiteDatabase,
): Promise<DrainPendingRemoteChangesResult> {
  const staged = await loadPendingRemoteChanges(rawDb as never);

  if (staged.length === 0) {
    return { applied: 0, dropped: 0, deferred: 0, drainedCount: 0 };
  }

  const changes = staged.map((entry) => entry.change);
  const stagingIds = staged.map((entry) => entry.stagingId);

  const result = await withDeferredWrite(rawDb, async (writeDb) => {
    const recordIds = changes.map((change) => change.recordId);
    const [guardByRecordId, pendingOutboxRecordIds] = await Promise.all([
      loadGuardMap(writeDb, recordIds),
      loadPendingOutboxRecordIds(writeDb),
    ]);

    const applyResult = await applyRemoteChanges(
      writeDb,
      changes,
      { guardByRecordId, pendingOutboxRecordIds },
      'deferred',
    );

    await deletePendingRemoteChanges(writeDb, stagingIds);

    return applyResult;
  });

  return { ...result, drainedCount: staged.length };
}
