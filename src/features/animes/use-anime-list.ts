import { eq } from "drizzle-orm";
import { useMemo } from "react";
import { createDrizzleDb } from "../../infrastructure/db/client/client.helpers";
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import {
  animes,
  seasonRatingQueue,
  type AnimeRow,
  type SeasonRatingQueueRow,
} from "../../infrastructure/db/schema";
import { useActiveSeasonStore } from "../../infrastructure/store/active-season-store";
import { useSeasonModeStore } from "../../infrastructure/store/season-mode-store";
import { buildAnimeSeasonProjection } from "./anime-season.helpers";
import {
  matchesAnimeDayFilter,
  parseAnimeRow,
  sortAnimesBySelectedDay,
} from "./anime.helpers";
import type { AnimeListItem } from "./anime-season.types";
import type { AnimeDayFilter } from "./anime.types";

/** Coordinates anime list state and actions. */
export function useAnimeList(filter: AnimeDayFilter) {
  const rawDb = useOptionalSQLiteContext();
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const activeSeasonSnapshot = useActiveSeasonStore(
    (state) => state.activeSeasonSnapshot,
  );
  const seasonMode = useSeasonModeStore((state) => state.seasonMode);

  const animeQuery = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(animes).where(eq(animes.activo, 1));
  }, [db]);

  const seasonRatingQueueQuery = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(seasonRatingQueue);
  }, [db]);

  const { data } = useOptionalLiveQuery<AnimeRow[]>(animeQuery, []);
  const { data: seasonRatingQueueRows } = useOptionalLiveQuery<SeasonRatingQueueRow[]>(
    seasonRatingQueueQuery,
    [],
  );
  const allowLocalActiveFallback = useMemo(
    () => seasonMode && filter === "Ver hoy",
    [filter, seasonMode],
  );

  const allActiveAnimes = useMemo<AnimeListItem[]>(() => {
    if (!data) return [];
    return data.map((row) => {
      const anime = parseAnimeRow(row);

        return {
          ...anime,
          seasonProjection: buildAnimeSeasonProjection({
            animeId: anime._id,
            allowLocalActiveFallback:
              allowLocalActiveFallback && matchesAnimeDayFilter(anime, filter),
            activeSeasonSnapshot,
            seasonRatingQueueRows,
          }),
        };
      });
  }, [activeSeasonSnapshot, allowLocalActiveFallback, data, filter, seasonRatingQueueRows]);

  const parsedData = useMemo(
    () => sortAnimesBySelectedDay(allActiveAnimes, filter),
    [allActiveAnimes, filter],
  );

  return {
    data: parsedData,
    allActiveAnimes,
  };
}
