import type { Anime } from "../../infrastructure/validation/anime-schema";
import {
  ANIME_MUTATION_PROJECTION_ENTRY_ID,
  ANIME_MUTATION_PROJECTION_LISTENERS,
  ANIME_MUTATION_PROJECTION_STORE,
  INITIAL_ANIME_MUTATION_PROJECTION_STATE,
  NO_ANIME_MUTATION_PROJECTION_ENTRIES,
} from "./anime-mutation-projection.constants";
import type {
  AnimeMutationProjectionEntry,
  AnimeMutationProjectionFields,
  AnimeMutationProjectionState,
} from "./anime-mutation-projection.types";

/**
 * What replaying the intents over one starting value produced: the value reached and the
 * entries that actually contributed to it.
 *
 * The two travel together because every consumer asks the same question -- "which intents
 * still describe this row?" -- and a second fold written for the other half would be free to
 * disagree with this one.
 */
interface AnimeMutationProjectionFold {
  readonly fields: AnimeMutationProjectionFields;
  readonly entries: readonly AnimeMutationProjectionEntry[];
}

/**
 * Replays the accepted intents over `from`, in acceptance order, keeping only those that
 * continue the chain.
 *
 * An entry applies when the value reached so far is exactly the one it was built from, which
 * is what makes the overlay self-retiring: the moment the durable row carries a value an entry
 * did not originate, that entry and every intent computed from it stop describing the row, and
 * the fold skips to whichever later entry continues the durable value instead.
 */
function foldAnimeMutationProjection(
  entries: readonly AnimeMutationProjectionEntry[],
  from: AnimeMutationProjectionFields,
): AnimeMutationProjectionFold {
  let fields = from;
  const applied: AnimeMutationProjectionEntry[] = [];

  for (const entry of entries) {
    if (
      entry.base.nrocapvisto !== fields.nrocapvisto ||
      entry.base.estado !== fields.estado
    ) {
      continue;
    }

    fields = entry.projected;
    applied.push(entry);
  }

  return { fields, entries: applied };
}

/** Replaces the projection and tells every consumer about it. */
function publishAnimeMutationProjection(next: AnimeMutationProjectionState): void {
  ANIME_MUTATION_PROJECTION_STORE.state = next;

  for (const listener of ANIME_MUTATION_PROJECTION_LISTENERS) {
    listener();
  }
}

/**
 * Replaces the projection without notifying consumers.
 *
 * Used when a durable read changes no drawn value: the list already re-renders for the row
 * that caused the read, and notifying here would only add a second render for the same fact.
 */
function recordAnimeMutationProjection(next: AnimeMutationProjectionState): void {
  ANIME_MUTATION_PROJECTION_STORE.state = next;
}

/**
 * Whether the durable row already carries the value the accepted intents fold to.
 *
 * True for the untouched case (nothing was ever accepted) and, decisively, for a chain that comes
 * back to where it started -- a +1 followed by a -1 settles on the value the row already holds, so
 * the row carries the whole chain and there is nothing left to project. Without this the chain
 * would replay forever: it folds to the durable value, so no entry ever looks superseded, and one
 * entry pair would accumulate per tap cycle for the whole session.
 */
function isAnimeMutationProjectionAbsorbed(
  anime: Anime,
  folded: AnimeMutationProjectionFold,
): boolean {
  return (
    folded.fields.nrocapvisto === anime.nrocapvisto &&
    folded.fields.estado === anime.estado
  );
}

/** Returns the latest projection snapshot. */
export function getAnimeMutationProjectionState(): AnimeMutationProjectionState {
  return ANIME_MUTATION_PROJECTION_STORE.state;
}

/** Subscribes a consumer to projection changes; returns the unsubscribe. */
export function subscribeAnimeMutationProjection(listener: () => void): () => void {
  ANIME_MUTATION_PROJECTION_LISTENERS.add(listener);

  return () => {
    ANIME_MUTATION_PROJECTION_LISTENERS.delete(listener);
  };
}

/**
 * Applies the intents that still describe `anime` on top of its durable values.
 *
 * Returns the same object when there is nothing to overlay, so the list keeps sharing the
 * item of every anime whose visible data a write did not change.
 */
export function applyAnimeMutationProjection(
  anime: Anime,
  state: AnimeMutationProjectionState,
): Anime {
  const record = state.byAnimeId[anime._id];

  if (!record) {
    return anime;
  }

  const folded = foldAnimeMutationProjection(record.entries, {
    nrocapvisto: anime.nrocapvisto,
    estado: anime.estado,
  });

  if (folded.entries.length === 0) {
    return anime;
  }

  return {
    ...anime,
    nrocapvisto: folded.fields.nrocapvisto,
    estado: folded.fields.estado,
  };
}

/**
 * Accepts one gesture into the projection and returns its entry id.
 *
 * Called before the write is awaited, which is the whole point: the displayed value moves now
 * and the write persists it afterwards. Returns `null` when there is nothing to project -- no
 * durable row has been read yet, or the gesture would not change the values it shows -- so a
 * caller never marks a no-op as pending.
 */
export function acceptAnimeMutationProjection(
  animeId: string,
  buildProjected: (base: Anime) => AnimeMutationProjectionFields,
): number | null {
  const state = ANIME_MUTATION_PROJECTION_STORE.state;
  const record = state.byAnimeId[animeId];

  if (!record?.durable) {
    return null;
  }

  const base = applyAnimeMutationProjection(record.durable, state);
  const baseFields: AnimeMutationProjectionFields = {
    nrocapvisto: base.nrocapvisto,
    estado: base.estado,
  };
  const projected = buildProjected(base);

  if (
    projected.nrocapvisto === baseFields.nrocapvisto &&
    projected.estado === baseFields.estado
  ) {
    return null;
  }

  ANIME_MUTATION_PROJECTION_ENTRY_ID.current += 1;
  const entry: AnimeMutationProjectionEntry = {
    id: ANIME_MUTATION_PROJECTION_ENTRY_ID.current,
    base: baseFields,
    projected,
  };

  publishAnimeMutationProjection({
    byAnimeId: {
      ...state.byAnimeId,
      [animeId]: {
        durable: record.durable,
        entries: [...record.entries, entry],
      },
    },
  });

  return entry.id;
}

/**
 * Drops a rejected intent, and every intent accepted after it.
 *
 * The successors go with it because each was built from a value that included the failed one,
 * so none of them describes a row that can still exist. Their own writes are untouched: they
 * stay in the existing queue and land on whatever the row holds when their turn comes.
 */
export function dropAnimeMutationProjection(animeId: string, entryId: number): void {
  const state = ANIME_MUTATION_PROJECTION_STORE.state;
  const record = state.byAnimeId[animeId];
  const index = record?.entries.findIndex((entry) => entry.id === entryId) ?? -1;

  if (!record || index < 0) {
    return;
  }

  publishAnimeMutationProjection({
    byAnimeId: {
      ...state.byAnimeId,
      [animeId]: { durable: record.durable, entries: record.entries.slice(0, index) },
    },
  });
}

/**
 * Records the durable rows just read and retires the intents those rows have absorbed.
 *
 * Called by the list after it renders the rows, so the projection's base and its leftovers
 * always describe the row the screen is showing rather than one from a previous read.
 */
export function observeAnimeMutationDurability(animes: readonly Anime[]): void {
  const state = ANIME_MUTATION_PROJECTION_STORE.state;
  const byAnimeId = { ...state.byAnimeId };
  let didRetire = false;
  let didChange = false;

  for (const anime of animes) {
    const record = byAnimeId[anime._id];
    const folded = foldAnimeMutationProjection(record?.entries ?? [], {
      nrocapvisto: anime.nrocapvisto,
      estado: anime.estado,
    });
    const entries = isAnimeMutationProjectionAbsorbed(anime, folded)
      ? NO_ANIME_MUTATION_PROJECTION_ENTRIES
      : folded.entries;
    const didPrune = record !== undefined && entries.length !== record.entries.length;

    if (record && record.durable === anime && !didPrune) {
      continue;
    }

    byAnimeId[anime._id] = { durable: anime, entries };
    didRetire = didRetire || didPrune;
    didChange = true;
  }

  // A read that changed nothing keeps the same snapshot: replacing it would make
  // `useSyncExternalStore` re-check on every render, which is a render loop rather than an
  // optimisation once the list is empty or unchanged.
  if (!didChange) {
    return;
  }

  const next = { byAnimeId };

  if (didRetire) {
    publishAnimeMutationProjection(next);
    return;
  }

  recordAnimeMutationProjection(next);
}

/** Forgets every intent and durable snapshot, so no run inherits another one's projection. */
export function resetAnimeMutationProjection(): void {
  ANIME_MUTATION_PROJECTION_ENTRY_ID.current = 0;
  ANIME_MUTATION_PROJECTION_STORE.state = INITIAL_ANIME_MUTATION_PROJECTION_STATE;
}
