import { eq } from 'drizzle-orm';
import { applyAnimePartial, upsertAnime } from '../../../infrastructure/db/anime-repository';
import type { AppDatabase } from '../../../infrastructure/db/client';
import { animes } from '../../../infrastructure/db/schema';
import { recordDiagnosticEvent } from '../sync-diagnostic-store/sync-diagnostic-store.helpers';
import { buildPartialUpdate } from './field-merge.helpers';
import { decideMerge } from './merge-decision.helpers';
import type { ApplyRemoteChangesResult, MergeContext, RemoteAnimeChange } from './merge.types';

/** What happened to one accepted change: written, rejected as not understood, or nothing to write. */
type AcceptedChangeOutcome = 'applied' | 'rejected' | 'skipped';

/**
 * Writes one change the merge boundary already decided to accept. A `create` inserts the full
 * snapshot; an `update` looks the record up first and upserts when it is unknown, then writes
 * only the changed columns.
 *
 * An `update` whose `changed_fields` is empty after normalization is REJECTED: the bridge never
 * sends an empty list for an update, so an empty one means no field in it is known to this build.
 * Nothing is written -- not even the staleness guard -- because guessing which fields changed by
 * diffing the whole snapshot would overwrite the anime with values this build did not ask for.
 */
async function applyAcceptedChange(
  db: AppDatabase,
  change: RemoteAnimeChange,
): Promise<AcceptedChangeOutcome> {
  if (!change.snapshot) {
    return 'skipped';
  }

  if (change.changeType === 'create') {
    await upsertAnime(db, change.snapshot, change.timestamp);
    return 'applied';
  }

  // The existence check is UNCONDITIONAL (A10): the bridge emits `update` for anything created on
  // the PC while the phone was offline, and an UPDATE matching zero rows would report success for
  // a write that never happened. A record this device has never seen has no local copy to protect,
  // so the full snapshot is the only correct write.
  const [currentRow] = await db
    .select()
    .from(animes)
    .where(eq(animes._id, change.recordId))
    .limit(1);

  if (!currentRow) {
    await upsertAnime(db, change.snapshot, change.timestamp);
    return 'applied';
  }

  if (change.changedFields.length === 0) {
    recordDiagnosticEvent({
      source: 'sync_cycle',
      event: 'remote_change_rejected',
      cause: null,
      at: Date.now(),
    });
    return 'rejected';
  }

  const { columns } = buildPartialUpdate(change.changedFields, change.snapshot);
  await applyAnimePartial(db, change.recordId, columns, change.timestamp);
  return 'applied';
}

/**
 * The single coordinator every remote->local `animes` write routes through. For each
 * normalized change, evaluates `decideMerge` against the preloaded `MergeContext` and then:
 * - 'delete' -> deletes the row by `_id` (always wins, never deferred/dropped).
 * - 'apply' on an update -> partial column write via `applyAnimePartial` (never the full
 *   snapshot), stamping the per-anime staleness guard in the same statement.
 * - 'apply' on a create -> full-row insert via `upsertAnime` (cold create has no prior
 *   columns to preserve).
 * - 'apply' on an update with no known field -> rejected: no write, counted and recorded.
 * - 'drop_stale' / 'defer_outbox' -> no write; counted only. A deferred change is NOT discarded:
 *   `applyStagedAndIncomingRemoteChanges` keeps it staged for a later pass (ADR 009 R-16a).
 *
 * `applyMode` is accepted so callers can express where this coordinator runs (foreground
 * deferred-write vs background staged-write) but it is NOT used to change behavior here:
 * the caller is responsible for choosing whether to invoke this against a reactive
 * connection (`withLocalWrite`) or to stage the change instead of calling this at all.
 * Reconcile/WS/drain wiring is out of scope for this coordinator (later phase).
 */
export async function applyRemoteChanges(
  db: AppDatabase,
  changes: readonly RemoteAnimeChange[],
  ctx: MergeContext,
  _applyMode: 'deferred' | 'staged' = 'deferred',
): Promise<ApplyRemoteChangesResult> {
  let applied = 0;
  let dropped = 0;
  let deferred = 0;
  let rejected = 0;

  for (const change of changes) {
    const decision = decideMerge(change, ctx);

    switch (decision) {
      case 'delete': {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: each change writes/deletes the `animes` row inside the same transaction; changes for the same recordId must apply in order (last-write-wins), so parallelizing would risk out-of-order writes.
        await db.delete(animes).where(eq(animes._id, change.recordId));
        applied += 1;
        break;
      }
      case 'apply': {
        const outcome = await applyAcceptedChange(db, change);
        if (outcome === 'applied') {
          applied += 1;
        } else if (outcome === 'rejected') {
          rejected += 1;
        }
        break;
      }
      case 'drop_stale': {
        dropped += 1;
        break;
      }
      case 'defer_outbox': {
        deferred += 1;
        break;
      }
    }
  }

  return { applied, dropped, deferred, rejected };
}
