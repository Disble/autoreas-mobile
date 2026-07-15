import type { RemoteAnimeChange } from './merge';

/** Pairs a staged row identifier with its normalized remote anime change. */
export interface PendingRemoteChangeEntry {
  readonly stagingId: number;
  readonly change: RemoteAnimeChange;
}
