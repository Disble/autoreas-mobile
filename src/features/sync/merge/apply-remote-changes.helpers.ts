import { eq } from 'drizzle-orm';
import { applyAnimePartial, upsertAnime } from '../../../infrastructure/db/anime-repository';
import type { AppDatabase } from '../../../infrastructure/db/client';
import { animes } from '../../../infrastructure/db/schema';
import { buildPartialUpdate, deriveChangedFields } from './field-merge.helpers';
import { decideMerge } from './merge-decision.helpers';
import type { ApplyRemoteChangesResult, MergeContext, RemoteAnimeChange } from './merge.types';

/**
 * Writes one change the merge boundary already decided to accept. A `create` inserts the full
 * snapshot; an `update` looks the record up first and upserts when it is unknown, then writes
 * only the changed columns. Returns whether a write was issued.
 */
async function applyAcceptedChange(
  db: AppDatabase,
  change: RemoteAnimeChange,
): Promise<boolean> {
  if (!change.snapshot) {
    return false;
  }

  if (change.changeType === 'create') {
    await upsertAnime(db, change.snapshot, change.timestamp);
    return true;
  }

  // The existence check is UNCONDITIONAL (A10). It used to sit inside the
  // `changedFields.length === 0` branch, so an `update` carrying changed_fields for a record the
  // device had never seen fell straight through to `applyAnimePartial` -- an UPDATE ... WHERE
  // _id = ? matching zero rows -- and still returned true, incrementing `applied` for a write
  // that never happened. The bridge emits `update` for anything created on the PC while the
  // phone was offline, so that was the ORDINARY path for such records, not an edge case, and the
  // diagnostic counter reported success for its own failure.
  const [currentRow] = await db
    .select()
    .from(animes)
    .where(eq(animes._id, change.recordId))
    .limit(1);

  if (!currentRow) {
    await upsertAnime(db, change.snapshot, change.timestamp);
    return true;
  }

  let effectiveFields: readonly string[] = change.changedFields;
  if (effectiveFields.length === 0) {
    effectiveFields = deriveChangedFields(change.snapshot, currentRow);
  }

  const { columns } = buildPartialUpdate(effectiveFields, change.snapshot);
  await applyAnimePartial(db, change.recordId, columns, change.timestamp);
  return true;
}

/**
 * The single coordinator every remote->local `animes` write routes through. For each
 * normalized change, evaluates `decideMerge` against the preloaded `MergeContext` and then:
 * - 'delete' -> deletes the row by `_id` (always wins, never deferred/dropped).
 * - 'apply' on an update -> partial column write via `applyAnimePartial` (never the full
 *   snapshot), stamping the per-anime staleness guard in the same statement.
 * - 'apply' on a create -> full-row insert via `upsertAnime` (cold create has no prior
 *   columns to preserve).
 * - 'drop_stale' / 'defer_outbox' -> no write; counted only.
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
        if (await applyAcceptedChange(db, change)) {
          applied += 1;
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

  return { applied, dropped, deferred };
}
