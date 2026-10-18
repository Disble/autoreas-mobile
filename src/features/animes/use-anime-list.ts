import { eq } from "drizzle-orm";
import { useMemo } from "react";
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
import { buildAnimeSeasonProjection } from "./anime-season.helpers";
import {
  parseAnimeRow,
  sortAnimesBySelectedDay,
} from "./anime.helpers";
import type { AnimeListItem } from "./anime-season.types";
import type { AnimeDayFilter } from "./anime.types";

/** Coordinates anime list state and actions. */
export function useAnimeList(filter: AnimeDayFilter) {
  const rawDb = useOptionalSQLiteContext();
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);

  const animeQuery = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(animes).where(eq(animes.activo, 1));
  }, [db]);

  const seasonRatingIntentsQuery = useMemo(
    () => (db ? buildSeasonRatingIntentsQuery(db) : null),
    [db],
  );

  const { data } = useOptionalLiveQuery<AnimeRow[]>(animeQuery, []);
  const { data: seasonRatingRows } = useOptionalLiveQuery<OperationLogRow[]>(
    seasonRatingIntentsQuery,
    [],
  );
  const seasonRatingIntents = useMemo(
    () => mapSeasonRatingIntents(seasonRatingRows ?? []),
    [seasonRatingRows],
  );
  const allActiveAnimes = useMemo<AnimeListItem[]>(() => {
    if (!data) return [];
    return data.map((row) => {
      const anime = parseAnimeRow(row);

        return {
          ...anime,
          seasonProjection: buildAnimeSeasonProjection({
            animeId: anime._id,
            season: anime.season,
            seasonRatingIntents,
          }),
        };
      });
  }, [data, seasonRatingIntents]);

  const parsedData = useMemo(
    () => sortAnimesBySelectedDay(allActiveAnimes, filter),
    [allActiveAnimes, filter],
  );

  return {
    data: parsedData,
    allActiveAnimes,
  };
}
