import { isStale } from './field-merge.helpers';
import type { MergeContext, MergeDecision, RemoteAnimeChange } from './merge.types';

/**
 * Evaluates a single normalized remote change against the per-anime staleness guard and the
 * outbox-protection rule. Evaluation order is fixed: delete > outbox-owned > stale > apply.
 * Deletes always win (a remote delete is never deferred or dropped by this boundary).
 * Outbox protection wins over staleness so an unconfirmed local mutation is never reverted
 * by a newer-looking but conflicting remote echo. Idempotent re-delivery (timestamp <=
 * guard) yields `drop_stale`, so applying the same change twice is a no-op.
 */
export function decideMerge(change: RemoteAnimeChange, ctx: MergeContext): MergeDecision {
  if (change.changeType === 'delete') {
    return 'delete';
  }

  if (ctx.pendingOutboxRecordIds.has(change.recordId)) {
    return 'defer_outbox';
  }

  const guard = ctx.guardByRecordId.get(change.recordId) ?? null;

  if (isStale(change.timestamp, guard)) {
    return 'drop_stale';
  }

  return 'apply';
}
