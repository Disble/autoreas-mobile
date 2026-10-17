import type { UNRESOLVED_RESOLUTION_ERROR_CODE } from './unresolved-key.constants';

/**
 * How a person settles an unresolved key (ADR 009 R-16b): keep the local intent and send it again
 * from a fresh base, or drop it and take the bridge's state.
 */
export type UnresolvedChoice = 'keep_local' | 'keep_bridge';

/**
 * Names one unresolved key. An outbox key is the anime; a season-rating key is the anime's rating
 * within one season.
 */
export type UnresolvedKeyRef =
  | { readonly kind: 'anime'; readonly animeId: string }
  | { readonly kind: 'season_rating'; readonly seasonId: string; readonly animeId: string };

/** One given-up `operation_log` row of an unresolved anime key. */
export interface UnresolvedOperationRow {
  readonly id: number;
  readonly status: string;
  readonly unresolvedReason: string | null;
}

/** One given-up `season_rating` row of an unresolved rating key, with why the bridge refused it. */
export interface UnresolvedRatingRow {
  readonly id: number;
  readonly unresolvedReason: string | null;
}

/**
 * One unresolved key with the rows that make it unresolved and the choices it offers. A key the
 * bridge does not have (404) or returned without a token offers only `keep_bridge`.
 */
export type UnresolvedKey =
  | (Extract<UnresolvedKeyRef, { kind: 'anime' }> & {
      readonly rows: readonly UnresolvedOperationRow[];
      readonly offeredChoices: readonly UnresolvedChoice[];
    })
  | (Extract<UnresolvedKeyRef, { kind: 'season_rating' }> & {
      readonly rows: readonly UnresolvedRatingRow[];
      readonly offeredChoices: readonly UnresolvedChoice[];
    });

/** Why the resolution entry point refused a request; nothing was written when it refuses. */
export type UnresolvedResolutionErrorCode =
  (typeof UNRESOLVED_RESOLUTION_ERROR_CODE)[keyof typeof UNRESOLVED_RESOLUTION_ERROR_CODE];

/**
 * One unresolved key resolved without anyone choosing (ADR 009 R-16b, L18): the key, the given-up
 * rows that were removed, and why.
 */
export interface AutomaticResolution {
  readonly key: UnresolvedKeyRef;
  readonly reason: string;
  readonly rows: readonly (UnresolvedOperationRow | UnresolvedRatingRow)[];
}

/** A confirmed row whose key may hold given-up rows it supersedes. */
export interface ConfirmedOperation {
  readonly id: number;
  readonly animeId: string;
}
