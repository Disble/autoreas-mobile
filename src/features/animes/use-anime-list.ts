import { eq } from 'drizzle-orm';
import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { animes, type AnimeRow } from '../../infrastructure/db/schema';
import { parseAnimeRow, sortAnimesBySelectedDay } from './anime.helpers';
import type { AnimeDayFilter } from './anime.types';

export function useAnimeList(filter: AnimeDayFilter) {
  const rawDb = useOptionalSQLiteContext();
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);

  const query = useMemo(() => {
    if (!db) {
      return null;
    }

    return db
      .select()
      .from(animes)
      .where(eq(animes.activo, 1));
  }, [db]);

  const { data } = useOptionalLiveQuery<AnimeRow[]>(query, []);

  const allActiveAnimes = useMemo(() => {
    if (!data) return [];
    return data.map(parseAnimeRow);
  }, [data]);

  const parsedData = useMemo(
    () => sortAnimesBySelectedDay(allActiveAnimes, filter),
    [allActiveAnimes, filter],
  );

  return {
    data: parsedData,
    allActiveAnimes,
  };
}
