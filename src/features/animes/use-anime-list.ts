import { eq } from "drizzle-orm";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createDrizzleDb } from "../../infrastructure/db/client/client.helpers";
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import {
  animes,
  type AnimeRow,
  type OperationLogRow,
} from "../../infrastructure/db/schema";
import { mapSeasonRatingIntents } from "../sync/season-rating-event.helpers";
import { buildSeasonRatingIntentsQuery } from "../sync/season-rating-intent.helpers";
import {
  applyAnimeMutationProjection,
  getAnimeMutationProjectionState,
  observeAnimeMutationDurability,
  subscribeAnimeMutationProjection,
} from "./anime-mutation-projection.helpers";
import { createAnimeListItemSharer } from "./anime-list.helpers";
import { buildAnimeSeasonProjection } from "./anime-season.helpers";
import {
  parseAnimeRow,
  sortAnimesBySelectedDay,
} from "./anime.helpers";
import type { AnimeListItem } from "./anime-season.types";
import type { AnimeDayFilter } from "./anime.types";

/**
 * Reads the active animes with their season projection, sorted for the selected filter. An anime whose
 * row and projection did not change keeps its previous item object across database writes, so the list
 * re-renders only the cards whose anime changed.
 *
 * The chapter intents the user has accepted but the database has not stored yet are overlaid here,
 * from the same in-memory projection the action path publishes into: that is what lets a card show
 * the next chapter before its write has settled, without the durable row losing its authority.
 */
export function useAnimeList(filter: AnimeDayFilter) {
  // 2. State
  // One sharer per mounted list: it remembers the last items it returned (see the helper).
  const [shareAnimeListItems] = useState(createAnimeListItemSharer);

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  // Re-renders the list when an intent is accepted or dropped, since no database write happened yet.
  const mutationProjection = useSyncExternalStore(
    subscribeAnimeMutationProjection,
    getAnimeMutationProjectionState,
  );

  // 4. Queries/Mutations
  // The db and both queries stay memoised by hand: the live queries subscribe by query identity, so
  // this is a correctness guarantee rather than a render optimisation, and Jest runs uncompiled.
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const animeQuery = useMemo(
    () => (db ? db.select().from(animes).where(eq(animes.activo, 1)) : null),
    [db],
  );
  const seasonRatingIntentsQuery = useMemo(
    () => (db ? buildSeasonRatingIntentsQuery(db) : null),
    [db],
  );
  const { data } = useOptionalLiveQuery<AnimeRow[]>(animeQuery, []);
  const { data: seasonRatingRows } = useOptionalLiveQuery<OperationLogRow[]>(
    seasonRatingIntentsQuery,
    [],
  );

  // 5. Derived State
  const seasonRatingIntents = mapSeasonRatingIntents(seasonRatingRows ?? []);
  const allActiveAnimes = shareAnimeListItems(
    (data ?? []).map((row): AnimeListItem => {
      const anime = applyAnimeMutationProjection(parseAnimeRow(row), mutationProjection);

      return {
        ...anime,
        seasonProjection: buildAnimeSeasonProjection({
          animeId: anime._id,
          season: anime.season,
          seasonRatingIntents,
        }),
      };
    }),
  );
  const parsedData = sortAnimesBySelectedDay(allActiveAnimes, filter);

  // 7. Effects
  // The durable rows of this render are the projection's base and the retirement signal: it is
  // observed after the rows are drawn, never instead of them.
  useEffect(() => {
    observeAnimeMutationDurability((data ?? []).map(parseAnimeRow));
  }, [data]);

  return {
    data: parsedData,
    allActiveAnimes,
  };
}
