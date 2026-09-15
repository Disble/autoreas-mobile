import type { BridgeAnimeCoverResult } from '../../../infrastructure/api';
import type { CoverManifestEntry } from '../../../infrastructure/cover-files';
import {
  COVER_REVALIDATE_MS,
  COVER_TRANSIENT_BASE_DELAY_MS,
  COVER_TRANSIENT_MAX_DELAY_MS,
  COVER_UNKNOWN_RECHECK_MS,
} from './cover-sweep.constants';

/**
 * Computes the next transient-failure delay: the bridge's own `Retry-After` when it gave one,
 * otherwise exponential backoff from `COVER_TRANSIENT_BASE_DELAY_MS`, doubling per failure and
 * clamped at `COVER_TRANSIENT_MAX_DELAY_MS`. `failureCount` is the NEW (post-increment) count, so
 * the first failure (1) yields exactly the base delay.
 */
export function computeTransientDelayMs(failureCount: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  const exponent = Math.max(failureCount - 1, 0);
  const backoffMs = COVER_TRANSIENT_BASE_DELAY_MS * 2 ** exponent;

  return Math.min(backoffMs, COVER_TRANSIENT_MAX_DELAY_MS);
}

/** `image`: the new file replaces the entry outright (fresh etag, 7-day revalidation, failures cleared). */
function resolveImageEntry(
  newFileName: string,
  etag: string | null,
  now: number,
  sourceKey: string | null,
): CoverManifestEntry {
  return {
    status: 'image',
    fileName: newFileName,
    etag,
    checkedAt: now,
    nextAttemptAt: now + COVER_REVALIDATE_MS,
    failureCount: 0,
    sourceKey,
  };
}

/**
 * `not_modified`: the existing file is still current, so only its etag/checkedAt/nextAttemptAt
 * move forward -- UNLESS there is no previous file, in which case the answer cannot be trusted
 * (nothing to keep) and the entry is downgraded to `transient` with an immediate retry.
 */
function resolveNotModifiedEntry(
  previous: CoverManifestEntry | null,
  etag: string | null,
  now: number,
  sourceKey: string | null,
): CoverManifestEntry {
  if (!previous?.fileName) {
    return {
      status: 'transient',
      fileName: null,
      etag: null,
      checkedAt: previous?.checkedAt ?? null,
      nextAttemptAt: now,
      failureCount: 0,
      sourceKey,
    };
  }

  return {
    status: 'image',
    fileName: previous.fileName,
    etag: etag ?? previous.etag,
    checkedAt: now,
    nextAttemptAt: now + COVER_REVALIDATE_MS,
    failureCount: 0,
    sourceKey,
  };
}

/**
 * `absent`: the bridge has no cover to serve. When the anime's cover source is unchanged, the last
 * good file and etag are KEPT: the bridge serves the user's original local path, so a file moved or
 * deleted on the PC becomes a permanent 204 although nobody edited the cover, and a cover must
 * never stop loading. Only a changed source (the cover was edited or removed) clears the file.
 */
function resolveAbsentEntry(
  previous: CoverManifestEntry | null,
  now: number,
  sourceKey: string | null,
): CoverManifestEntry {
  const lastGoodFileName = previous?.sourceKey === sourceKey ? (previous?.fileName ?? null) : null;

  return {
    status: 'absent',
    fileName: lastGoodFileName,
    etag: lastGoodFileName ? (previous?.etag ?? null) : null,
    checkedAt: now,
    nextAttemptAt: now + COVER_REVALIDATE_MS,
    failureCount: 0,
    sourceKey,
  };
}

/**
 * `unknown`: a 404 never wipes an offline-safe file or etag -- a downgraded or stale bridge must
 * not erase what is already on disk.
 */
function resolveUnknownEntry(
  previous: CoverManifestEntry | null,
  now: number,
  sourceKey: string | null,
): CoverManifestEntry {
  return {
    status: 'unknown',
    fileName: previous?.fileName ?? null,
    etag: previous?.etag ?? null,
    checkedAt: now,
    nextAttemptAt: now + COVER_UNKNOWN_RECHECK_MS,
    failureCount: 0,
    sourceKey,
  };
}

/**
 * `transient` (and the unreachable-in-practice `unauthorized` fallback, see the caller):
 * nothing about the file changes; only the failure bookkeeping advances. `sourceKey` is always the
 * key of the request just made (not the previous entry's), so a transient failure right after a
 * source change keeps the NEW key -- backoff applies normally instead of re-asking every pass.
 */
function resolveTransientEntry(
  previous: CoverManifestEntry | null,
  retryAfterMs: number | null,
  now: number,
  sourceKey: string | null,
): CoverManifestEntry {
  const nextFailureCount = (previous?.failureCount ?? 0) + 1;

  return {
    status: previous?.status ?? 'transient',
    fileName: previous?.fileName ?? null,
    etag: previous?.etag ?? null,
    checkedAt: previous?.checkedAt ?? null,
    nextAttemptAt: now + computeTransientDelayMs(nextFailureCount, retryAfterMs),
    failureCount: nextFailureCount,
    sourceKey,
  };
}

/**
 * Folds one bridge cover result into the next manifest entry for an anime. `newFileName` is only
 * meaningful for the `image` kind (the caller -- `applyCoverFileChange` -- always supplies a real
 * name there); every other kind either clears or preserves the previous file name and ignores it.
 * `sourceKey` is the normalized `portada` (see `normalizeCoverSourceKey`) the request was made
 * for, and every branch stores it on the resulting entry so a later pass can tell a stale
 * `nextAttemptAt` apart from a changed cover (see `selectCoverSweepTargets`).
 * Dispatches to one small `resolve*Entry` helper per kind -- see each helper's own doc comment
 * for its contract.
 */
export function resolveCoverManifestEntry(
  previous: CoverManifestEntry | null,
  result: BridgeAnimeCoverResult,
  now: number,
  newFileName: string | null,
  sourceKey: string | null,
): CoverManifestEntry {
  switch (result.kind) {
    case 'image':
      if (newFileName === null) {
        // Defensive only: an `image` result is always paired with a real file name by
        // `applyCoverFileChange`. This branch exists so the parameter can be honestly typed
        // `string | null` (it is meaningless for every other kind) without an unsafe non-null
        // assertion here. Falls back to a retry rather than fabricating a file reference.
        return resolveTransientEntry(previous, null, now, sourceKey);
      }
      return resolveImageEntry(newFileName, result.etag, now, sourceKey);
    case 'not_modified':
      return resolveNotModifiedEntry(previous, result.etag, now, sourceKey);
    case 'absent':
      return resolveAbsentEntry(previous, now, sourceKey);
    case 'unknown':
      return resolveUnknownEntry(previous, now, sourceKey);
    case 'transient':
      return resolveTransientEntry(previous, result.retryAfterMs, now, sourceKey);
    case 'unauthorized':
    default:
      // Never actually reaches here -- the worker checks `shouldStopCoverSweep` first and never
      // resolves an entry for `unauthorized` -- but the parameter type is the full
      // `BridgeAnimeCoverResult` union, so every member needs a branch.
      return resolveTransientEntry(previous, null, now, sourceKey);
  }
}
