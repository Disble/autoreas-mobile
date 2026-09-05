import type { ReconcileAppliedOperation } from './reconcile.schema';
import type { ConfirmedAnimeToken } from './applied-operation-token.types';

export type { ConfirmedAnimeToken } from './applied-operation-token.types';

/**
 * Collects the bridge-confirmed OCC token from a batch of `applied_operations` entries.
 *
 * PRESENCE, not truthiness. An entry whose `modified_at` key is ABSENT contributes nothing; an
 * entry carrying `0` contributes a real token (invariant 3/7). Only `applied: true` entries are
 * read here -- a rejection's token belongs to the Part 2 conflict re-base. When one anime appears
 * more than once, the LAST entry wins: the bridge applies in order, so the last entry carries the
 * final state.
 *
 * DO NOT merge with `buildOptimisticBaseKey`. Its correct behaviour is the INVERSE of this one's
 * (see design.md Decision 4); a shared helper reintroduces both bugs at once.
 */
export function collectConfirmedAnimeTokens(
  appliedOperations: readonly ReconcileAppliedOperation[],
): ConfirmedAnimeToken[] {
  const tokenByAnimeId = new Map<string, number>();

  for (const operation of appliedOperations) {
    if (!operation.applied || operation.modified_at === undefined) {
      continue;
    }

    tokenByAnimeId.set(operation.anime_id, operation.modified_at);
  }

  return Array.from(tokenByAnimeId, ([animeId, bridgeModifiedAt]) => ({
    animeId,
    bridgeModifiedAt,
  }));
}
