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
 * The `unresolved_reason` of a given-up rating that leaves only `keep_bridge` on offer: the bridge
 * has no such target (404), so there is nothing to rate again.
 */
export const KEEP_BRIDGE_ONLY_RATING_REASON = 'not_found';

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
