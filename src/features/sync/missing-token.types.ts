import type { UNRESOLVED_REASON } from './missing-token.constants';

/** A reason fetch-first records when it gives a key up. */
export type UnresolvedReason = (typeof UNRESOLVED_REASON)[keyof typeof UNRESOLVED_REASON];

/**
 * What fetching one anime with no stored token decided (ADR 009 R-3): send with the token it
 * returned, keep the key pending because the bridge could not be asked, or give the key up.
 */
export type MissingTokenOutcome =
  | { readonly kind: 'token'; readonly token: number }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason };
