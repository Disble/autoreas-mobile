/**
 * Builds the two sync-internal columns present only when their caller explicitly supplies them
 * (`!== undefined`), never defaulted -- a caller that does not know the guard/token leaves each
 * column exactly as `onConflictDoUpdate` finds it, never overwritten with a fabricated value.
 * Split out of `upsertAnime` to keep that function's cognitive complexity under threshold.
 */
export function buildOptionalAnimeSyncColumns(guardMs?: number, bridgeModifiedAt?: number) {
  return {
    ...(guardMs !== undefined ? { lastAppliedChangeMs: guardMs } : {}),
    ...(bridgeModifiedAt !== undefined ? { bridgeModifiedAt } : {}),
  };
}
