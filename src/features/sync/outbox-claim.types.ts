/** Names the runtime that holds a per-key outbox claim (ADR 009 R-13). */
export type OutboxClaimOwner = 'js' | 'native';

/**
 * Identifies one claim exactly. A row is still held only while BOTH columns match: a key the
 * other runtime took over after expiry carries a different owner or time.
 */
export interface OutboxClaim {
  readonly owner: OutboxClaimOwner;
  readonly claimedAt: number;
}
