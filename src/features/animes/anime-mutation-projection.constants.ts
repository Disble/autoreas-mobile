import type {
  AnimeMutationProjectionEntry,
  AnimeMutationProjectionState,
} from "./anime-mutation-projection.types";

/** The neutral projection: no anime has an accepted intent waiting for its write. */
export const INITIAL_ANIME_MUTATION_PROJECTION_STATE: AnimeMutationProjectionState = {
  byAnimeId: {},
};

/**
 * The live projection. Replaced on every change so `useSyncExternalStore` sees a new
 * snapshot instead of a mutated one.
 */
export const ANIME_MUTATION_PROJECTION_STORE: {
  state: AnimeMutationProjectionState;
} = { state: INITIAL_ANIME_MUTATION_PROJECTION_STATE };

/** Notified on every projection change: the list's `useSyncExternalStore` subscription. */
export const ANIME_MUTATION_PROJECTION_LISTENERS = new Set<() => void>();

/** The id of the next accepted intent; unique for the life of the module. */
export const ANIME_MUTATION_PROJECTION_ENTRY_ID = { current: 0 };

/**
 * What an anime keeps once its durable row already carries the value its intents fold to: nothing.
 * Shared so every retirement path can hand back one immutable empty list instead of allocating one
 * per read.
 */
export const NO_ANIME_MUTATION_PROJECTION_ENTRIES: readonly AnimeMutationProjectionEntry[] = [];
