import type { Anime } from '../../infrastructure/validation/anime-schema';

/** Defines a mutation patch factory derived from the current anime snapshot. */
export type AnimeMutationPatchBuilder = (anime: Anime, now: number) => AnimeMutationSyncPatch;

/** Defines the fields that an anime mutation synchronizes with the bridge. */
export interface AnimeMutationSyncPatch {
  readonly nrocapvisto: number;
  readonly fechaUltCapVisto: number;
  readonly estado?: number;
  readonly fechaEstreno?: number;
  readonly primeravez?: boolean;
}

/** Defines a serialized update operation ready for durable storage. */
export interface SerializedMutationOperation {
  readonly operation: 'update';
  readonly payload: string;
}
