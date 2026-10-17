import { sql, type SQL } from 'drizzle-orm';
import { bridgeConfig } from '../../infrastructure/db/schema';
import { MAX_REASONABLE_CHANGELOG_ID } from './last-changelog.constants';

/**
 * Builds the forward-only cursor value for `bridge_config.last_changelog_id` (ADR 009, R-6).
 * The comparison runs against the STORED value inside the write, not the snapshot this cycle read,
 * so a cursor the native runtime advanced while this request was in flight is never moved back.
 */
export function forwardOnlyChangelogCursor(nextLastChangelogId: number): SQL<number> {
  return sql<number>`MAX(COALESCE(${bridgeConfig.lastChangelogId}, 0), ${nextLastChangelogId})`;
}

/**
 * Reads the persisted changelog cursor from bridge config, defaulting to zero.
 * This keeps reconcile and incremental sync aligned on the same resume point.
 */
export function getLastChangelogId(
  config: { lastChangelogId?: unknown } | null,
): number {
  const value = config?.lastChangelogId;

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_REASONABLE_CHANGELOG_ID
    ? value
    : 0;
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
