import { eq, desc, and } from 'drizzle-orm';
import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { animes, type Anime as AnimeRow } from '../../infrastructure/db/schema';

export type AnimeTab = 'viendo' | 'estrenos' | 'todos';

export function useAnimeList(tab: AnimeTab = 'viendo') {
  const rawDb = useOptionalSQLiteContext();
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);

  const condition = useMemo(() => {
    switch (tab) {
      case 'viendo':
        return and(eq(animes.activo, 1), eq(animes.estado, 0));
      case 'estrenos':
        return and(eq(animes.activo, 1), eq(animes.primeravez, 1));
      case 'todos':
      default:
        return eq(animes.activo, 1);
    }
  }, [tab]);

  const query = useMemo(() => {
    if (!db) {
      return null;
    }

    return db
      .select()
      .from(animes)
      .where(condition)
      .orderBy(desc(animes.fechaUltCapVisto));
  }, [db, condition]);

  const { data } = useOptionalLiveQuery<AnimeRow[]>(query, []);

  return {
    data: data ?? [],
  };
}
