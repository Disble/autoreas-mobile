import type { AnimeListItem } from "./anime-season.types";

/**
 * Compares two values parsed from the database: primitives by identity, arrays element by element and
 * plain objects key by key, at any depth. List items carry only JSON-shaped data, so this is enough to
 * tell whether a freshly parsed copy says anything the previous one did not.
 */
function isSameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isSameData(value, right[index]))
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);

  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every((key) => Object.hasOwn(rightRecord, key) && isSameData(leftRecord[key], rightRecord[key]))
  );
}

/**
 * Creates the structural-sharing step of the anime list. Every write to the animes table re-parses
 * every row into a new object; the returned function hands back the object it returned last time for
 * any anime whose data did not change, so a row that only got its unchanged copy keeps its identity
 * and the list only re-renders the cards whose anime really changed. When no anime changed and the
 * order is the same, the previous array itself comes back.
 *
 * Only the last list is remembered, so an anime that leaves the list and comes back is a new object.
 * The reuse is an optimisation, never a source of data: a reused object is always equal to the fresh one.
 */
export function createAnimeListItemSharer(): (
  nextItems: readonly AnimeListItem[],
) => AnimeListItem[] {
  let previousItems: AnimeListItem[] = [];

  return function shareAnimeListItems(nextItems) {
    const previousById = new Map(previousItems.map((item) => [item._id, item]));
    const sharedItems = nextItems.map((item) => {
      const previous = previousById.get(item._id);

      return previous && isSameData(previous, item) ? previous : item;
    });
    const isUnchanged =
      sharedItems.length === previousItems.length &&
      sharedItems.every((item, index) => item === previousItems[index]);

    if (!isUnchanged) {
      previousItems = sharedItems;
    }

    return previousItems;
  };
}
