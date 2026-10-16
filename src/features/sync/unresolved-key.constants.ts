import type { UnresolvedChoice } from './unresolved-key.types';

/** The log prefix every unresolved-key resolution writes under (ADR 009 R-16b). */
export const UNRESOLVED_LOG_TAG = '[unresolved]';

/** The `operation_log` statuses of a given-up row: the row stays until its key is resolved. */
export const GIVEN_UP_OPERATION_STATUSES = ['dead_letter', 'conflict_exhausted'] as const;

/**
 * The `unresolved_reason` values that leave only `keep_bridge` on offer: the bridge has no such
 * anime, or returned one with no token, so there is no base to send the local intent on.
 */
export const KEEP_BRIDGE_ONLY_OPERATION_REASONS: readonly string[] = ['bridge_404', 'token_missing'];

/**
 * The `season_rating_queue.last_failure_kind` values of a given-up rating (status `failed`): the
 * bridge answered 4xx -- 404, 409, 401 (`auth_repair`) or any other 4xx (`rejected`), the same
 * fate a 4xx has in the anime outbox (ADR 009 R-5). Such a row is never sent again until its key
 * is resolved.
 */
export const UNRESOLVED_RATING_FAILURE_KINDS = ['not_found', 'conflict', 'auth_repair', 'rejected'] as const;

/** The rating failure kind that leaves only `keep_bridge` on offer: the bridge has no such target. */
export const KEEP_BRIDGE_ONLY_RATING_FAILURE_KIND = 'not_found';

/** Every code `UnresolvedResolutionError` carries. */
export const UNRESOLVED_RESOLUTION_ERROR_CODE = {
  notUnresolved: 'not_unresolved',
  choiceNotOffered: 'choice_not_offered',
  keyClaimed: 'key_claimed',
  notPaired: 'not_paired',
  bridgeUnreachable: 'bridge_unreachable',
  remoteStateUnavailable: 'remote_state_unavailable',
} as const;

/** Both choices, in the order they are offered. */
export const BOTH_CHOICES: readonly UnresolvedChoice[] = ['keep_local', 'keep_bridge'];

/** Only `keep_bridge`: the local intent has no base to be sent on. */
export const KEEP_BRIDGE_ONLY_CHOICES: readonly UnresolvedChoice[] = ['keep_bridge'];
