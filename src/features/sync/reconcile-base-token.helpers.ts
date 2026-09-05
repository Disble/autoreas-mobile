/**
 * Builds the optional `base` key for one outgoing reconcile operation, from the anime's stored
 * `bridge_modified_at`.
 *
 * OMISSION, not null. Returns `{}` for a `NULL` token so the spread emits NO `base` key at all
 * (invariant 2: the bridge's Go side unmarshals `"base": null` into `int64`'s zero value -- a
 * REAL token, not a bypass, so an explicit `null` would be silently treated as `base: 0`).
 * Returns `{ base: 0 }` for a stored `0`, which is itself a legitimate token (invariant 3), never
 * collapsed into the omitted case.
 *
 * DO NOT merge with `collectConfirmedAnimeTokens` (`applied-operation-token.helpers.ts`). Its
 * correct behaviour is the INVERSE of this one's (see design.md Decision 4): that side must
 * PRESERVE a real `0` and treat an absent key as "no token"; this side must ERASE a `NULL` (no
 * key at all) and treat a stored `0` as a real token to send. A shared "handles the optional
 * token" helper would reintroduce both bugs at once -- there is no canonical in-memory
 * representation of "no token" that is correct on both sides.
 */
export function buildOptimisticBaseKey(
  bridgeModifiedAt: number | null,
): { readonly base: number } | Record<string, never> {
  return bridgeModifiedAt === null ? {} : { base: bridgeModifiedAt };
}
