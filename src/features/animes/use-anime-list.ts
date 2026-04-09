import { and, desc, eq } from "drizzle-orm";
import { useMemo } from "react";
import { createDrizzleDb } from "../../infrastructure/db/client";
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime";
import { animes, type AnimeRow } from "../../infrastructure/db/schema";
import { parseAnimeRow } from "./anime.helpers";
import type { AnimeTab } from "./anime.types";

export function useAnimeList(tab: AnimeTab = "viendo") {
  const rawDb = useOptionalSQLiteContext();
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);

  const condition = useMemo(() => {
    switch (tab) {
      case "viendo":
        return and(eq(animes.activo, 1), eq(animes.estado, 0));
      case "estrenos":
        return and(eq(animes.activo, 1), eq(animes.primeravez, 1));
      case "todos":
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

  const parsedData = useMemo(() => {
    if (!data) return [];
    return data.map(parseAnimeRow);
  }, [data]);

  return {
    data: parsedData,
  };
}
