import type { Anime } from '../../infrastructure/validation/anime-schema';

/** Defines a mutation patch factory derived from the current anime snapshot. */
export type AnimeMutationPatchBuilder = (anime: Anime, now: number) => AnimeMutationSyncPatch;

/** Defines the fields that an anime mutation synchronizes with the bridge. */
export interface AnimeMutationSyncPatch {
  readonly episodesWatched: number;
  readonly lastWatchedAt: number;
  readonly status?: number;
  readonly premieredAt?: number;
  readonly firstCycle?: boolean;
}

/** Defines a serialized update operation ready for durable storage. */
export interface SerializedMutationOperation {
  readonly operation: 'update';
  readonly payload: string;
}
