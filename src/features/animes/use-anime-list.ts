import { eq, desc, and } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client';
import { animes } from '../../infrastructure/db/schema';

export type AnimeTab = 'viendo' | 'estrenos' | 'todos';

export function useAnimeList(tab: AnimeTab = 'viendo') {
  const rawDb = useSQLiteContext();
  const db = useMemo(() => createDrizzleDb(rawDb), [rawDb]);

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
    return db
      .select()
      .from(animes)
      .where(condition)
      .orderBy(desc(animes.fechaUltCapVisto));
  }, [db, condition]);

  const { data } = useLiveQuery(query);

  return {
    data: data ?? [],
  };
}
