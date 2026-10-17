import type { SQLiteDatabase } from 'expo-sqlite';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { applyRemoteChanges } from './merge/apply-remote-changes.helpers';
import { loadGuardMap, loadPendingOutboxRecordIds } from './merge/merge-context.helpers';
import { decideMerge } from './merge/merge-decision.helpers';
import type { ApplyRemoteChangesResult, MergeContext, RemoteAnimeChange } from './merge/merge.types';
import {
  deletePendingRemoteChanges,
  loadPendingRemoteChanges,
  stagePendingRemoteChanges,
} from './pending-remote-changes.helpers';
import type { PendingRemoteChangeEntry } from './pending-remote-changes.types';
import type { DrainPendingRemoteChangesResult } from './remote-change-drain.types';

/** One change in a merge pass: staged ones carry their staging id, incoming ones `null`. */
interface MergePassEntry {
  readonly stagingId: number | null;
  readonly change: RemoteAnimeChange;
}

/**
 * Whether a change `defer_outbox` skipped must be kept for a later pass. It is not kept when a
 * delete of the same anime at the same time or later is in this pass: the delete is applied now,
 * and re-applying the older change once the local edit is gone would bring the anime back.
 */
function isKeptDeferred(entry: MergePassEntry, entries: readonly MergePassEntry[], ctx: MergeContext): boolean {
  if (decideMerge(entry.change, ctx) !== 'defer_outbox') {
    return false;
  }

  return !entries.some(
    (other) =>
      other.change.changeType === 'delete' &&
      other.change.recordId === entry.change.recordId &&
      other.change.timestamp >= entry.change.timestamp,
  );
}

/**
 * Applies every staged `pending_remote_changes` row together with `incoming` through the merge
 * boundary, inside the caller's write door, so a remote change skipped by `defer_outbox` is never
 * lost behind an advancing cursor (ADR 009 R-16a).
 *
 * - Staged rows go first, then `incoming`, ordered by timestamp (stable), so each anime sees its
 *   changes in the order they happened and the staleness guard drops re-deliveries.
 * - A change deferred because its anime has an un-acked local op is KEPT staged (an incoming one
 *   is staged now) and re-evaluated, under the same merge rules, by the next pass: the next
 *   reconcile apply or the next drain. No pass of its own is scheduled.
 * - Every other staged row is deleted in the same transaction as its apply.
 */
export async function applyStagedAndIncomingRemoteChanges(
  writeDb: AppDatabase,
  incoming: readonly RemoteAnimeChange[],
): Promise<ApplyRemoteChangesResult> {
  const staged: readonly PendingRemoteChangeEntry[] = await loadPendingRemoteChanges(writeDb);
  const entries: MergePassEntry[] = [
    ...staged,
    ...incoming.map((change) => ({ stagingId: null, change })),
  ].sort((left, right) => left.change.timestamp - right.change.timestamp);
  const changes = entries.map((entry) => entry.change);
  const [guardByRecordId, pendingOutboxRecordIds] = await Promise.all([
    loadGuardMap(writeDb, changes.map((change) => change.recordId)),
    loadPendingOutboxRecordIds(writeDb),
  ]);
  const ctx: MergeContext = { guardByRecordId, pendingOutboxRecordIds };
  const result = await applyRemoteChanges(writeDb, changes, ctx);
  const consumedStagingIds: number[] = [];
  const keptIncoming: RemoteAnimeChange[] = [];

  for (const entry of entries) {
    const kept = isKeptDeferred(entry, entries, ctx);

    if (entry.stagingId === null) {
      if (kept) {
        keptIncoming.push(entry.change);
      }
    } else if (!kept) {
      consumedStagingIds.push(entry.stagingId);
    }
  }

  if (consumedStagingIds.length > 0) {
    await deletePendingRemoteChanges(writeDb, consumedStagingIds);
  }

  if (keptIncoming.length > 0) {
    await stagePendingRemoteChanges(writeDb, keptIncoming);
  }

  return result;
}

/**
 * Applies every currently staged `pending_remote_changes` row to `animes` via the shared
 * merge boundary, on the shared REACTIVE connection (`withLocalWrite`), so foreground
 * `useLiveQuery` consumers observe the result immediately. Background sync's writes reach
 * `animes` only here or in the foreground reconcile apply -- the native engine stages remote
 * changes and never writes `animes` directly (see `syncPendingOperations` staged mode).
 *
 * Drained rows are deleted in the SAME deferred transaction as the apply, so a crash between
 * apply and delete cannot silently lose a change: the next drain pass re-reads and re-applies,
 * and the per-anime staleness guard makes that re-apply a safe no-op for rows already applied.
 * A row deferred by an un-acked local op stays staged for a later pass (ADR 009 R-16a).
 *
 * No-ops (does not open a write transaction at all) when there is nothing staged, so a drain
 * triggered on every foreground/resume tick is cheap when idle.
 */
export async function drainPendingRemoteChanges(
  rawDb: SQLiteDatabase,
): Promise<DrainPendingRemoteChangesResult> {
  const staged = await loadPendingRemoteChanges(createDrizzleDb(rawDb));

  if (staged.length === 0) {
    return { applied: 0, dropped: 0, deferred: 0, rejected: 0 };
  }

  return withLocalWrite(rawDb, (writeDb) => applyStagedAndIncomingRemoteChanges(writeDb, []));
}
