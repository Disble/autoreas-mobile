/**
 * Reads the persisted changelog cursor from bridge config, defaulting to zero.
 * This keeps reconcile and incremental sync aligned on the same resume point.
 */
export function getLastChangelogId(
  config: { lastChangelogId?: number | null } | null,
): number {
  return config?.lastChangelogId ?? 0;
}

/**
 * Returns whether a new changelog cursor should replace the persisted one.
 * Persisting only monotonic advances avoids regressing incremental sync after stale responses.
 */
export function shouldPersistLastChangelogId(
  currentLastChangelogId: number,
  nextLastChangelogId: number,
): boolean {
  return nextLastChangelogId > currentLastChangelogId;
}
