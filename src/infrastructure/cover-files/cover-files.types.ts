/** Lifecycle status of one anime's cover entry in the local manifest. */
export type CoverManifestEntryStatus = 'image' | 'absent' | 'unknown' | 'transient';

/**
 * One anime's cover bookkeeping. `fileName` may stay set while `status` is `'unknown'` or
 * `'transient'` -- an offline-safe cover must never be wiped by a downgraded or old bridge, or by
 * a run of transient failures.
 *
 * `sourceKey` is the normalized `portada` (see `normalizeCoverSourceKey`) this entry was last
 * resolved against. It is OPTIONAL for backward compatibility: a v1 manifest persisted before this
 * field existed carries entries without it, and a missing `sourceKey` must count as a mismatch
 * against the current `portada` so the entry gets re-asked exactly once (see
 * `selectCoverSweepTargets`), never as a false match that would hide a changed cover forever.
 */
export interface CoverManifestEntry {
  readonly status: CoverManifestEntryStatus;
  readonly fileName: string | null;
  readonly etag: string | null;
  readonly checkedAt: number | null;
  readonly nextAttemptAt: number;
  readonly failureCount: number;
  readonly sourceKey?: string | null;
}

/** Persisted v1 cover manifest: every known anime's cover bookkeeping, keyed by anime id. */
export interface CoverManifest {
  readonly version: 1;
  readonly entries: Readonly<Record<string, CoverManifestEntry>>;
}
