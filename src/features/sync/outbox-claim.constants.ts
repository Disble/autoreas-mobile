/**
 * How long a per-key outbox claim stays live after `claimed_at` (ADR 009 R-13). Past it, the
 * other runtime may take the key, and recovery may reset the row.
 */
export const OUTBOX_CLAIM_TTL_MS = 60_000;

/** The `claim_owner` value the JS runtime writes. Kotlin's `:sync` process writes `'native'`. */
export const JS_OUTBOX_CLAIM_OWNER = 'js';

/** The column values that release a claim; spread into every guarded status write. */
export const RELEASED_CLAIM = { claimOwner: null, claimedAt: null } as const;

/**
 * How long one cycle keeps chaining sends per key (ADR 009 R-14). Past it, no further row of a
 * key is claimed; the rows left behind stay `pending` for the next cycle.
 */
export const OUTBOX_CHAIN_BUDGET_MS = 20_000;
