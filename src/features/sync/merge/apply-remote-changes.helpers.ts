import { eq } from 'drizzle-orm';
import { applyAnimePartial, upsertAnime } from '../../../infrastructure/db/anime-repository';
import type { AppDatabase } from '../../../infrastructure/db/client';
import { animes } from '../../../infrastructure/db/schema';
import { buildPartialUpdate, deriveChangedFields } from './field-merge.helpers';
import { decideMerge } from './merge-decision.helpers';
import type { MergeContext, RemoteAnimeChange } from './merge.types';

/**
 * Aggregate outcome of routing a batch of normalized remote changes through the merge
 * boundary: how many were written (create/update/delete), how many were dropped as stale,
 * and how many were deferred because the anime has an unresolved local outbox operation.
 */
export interface ApplyRemoteChangesResult {
  readonly applied: number;
  readonly dropped: number;
  readonly deferred: number;
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
 * connection (`withDeferredWrite`) or to stage the change instead of calling this at all.
 * Reconcile/WS/drain wiring is out of scope for this coordinator (later phase).
 */
export async function applyRemoteChanges(
  db: AppDatabase,
  changes: readonly RemoteAnimeChange[],
  ctx: MergeContext,
  applyMode: 'deferred' | 'staged' = 'deferred',
): Promise<ApplyRemoteChangesResult> {
  void applyMode;

  let applied = 0;
  let dropped = 0;
  let deferred = 0;

  for (const change of changes) {
    const decision = decideMerge(change, ctx);

    switch (decision) {
      case 'delete': {
        await db.delete(animes).where(eq(animes._id, change.recordId));
        applied += 1;
        break;
      }
      case 'apply': {
        if (!change.snapshot) {
          break;
        }

        if (change.changeType === 'create') {
          await upsertAnime(db, change.snapshot, change.timestamp);
          applied += 1;
          break;
        }

        // The bridge watcher detects legacy edits by content hash and does NOT populate
        // `changed_fields` at runtime, so it almost always arrives empty. When it does, derive
        // the changed set by diffing the snapshot against the current local row instead of
        // writing nothing. If the row doesn't exist locally yet, treat it as a cold create.
        let effectiveFields: readonly string[] = change.changedFields;
        if (effectiveFields.length === 0) {
          const [currentRow] = await db
            .select()
            .from(animes)
            .where(eq(animes._id, change.recordId))
            .limit(1);

          if (!currentRow) {
            await upsertAnime(db, change.snapshot, change.timestamp);
            applied += 1;
            break;
          }

          effectiveFields = deriveChangedFields(
            change.snapshot,
            currentRow as Record<string, unknown>,
          );
        }

        const { columns } = buildPartialUpdate(effectiveFields, change.snapshot);
        await applyAnimePartial(db, change.recordId, columns, change.timestamp);
        applied += 1;
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
