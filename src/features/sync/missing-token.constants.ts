/**
 * Why fetch-first gave a key up (ADR 009 R-3), stored in `operation_log.unresolved_reason` next to
 * the `dead_letter` status: the bridge has no such anime, or it returned one with no token.
 */
export const UNRESOLVED_REASON = {
  bridgeNotFound: 'bridge_404',
  tokenMissing: 'token_missing',
} as const;
