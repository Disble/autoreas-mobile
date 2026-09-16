/**
 * Global offline-cover URI projection, published by the cover sweep. The store stays ephemeral
 * (rehydrated from the on-disk manifest on every launch) so a stale URI never survives a cold
 * start pointing at a file that was pruned or replaced.
 */
export interface CoverUriStore {
  readonly coverUriByAnimeId: Readonly<Record<string, string>>;
  readonly setCoverUris: (coverUriByAnimeId: Readonly<Record<string, string>>) => void;
}
