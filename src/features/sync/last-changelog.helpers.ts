/**
 * Reads the persisted changelog cursor from bridge config, defaulting to zero.
 * This keeps reconcile and incremental sync aligned on the same resume point.
 */
export function getLastChangelogId(
  config: { lastChangelogId?: number | null | unknown } | null,
): number {
  const value = config?.lastChangelogId;

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
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
