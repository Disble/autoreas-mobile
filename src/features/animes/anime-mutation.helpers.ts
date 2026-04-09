import { createDrizzleDb } from '../../infrastructure/db/client';
import { animes, type AnimeRow } from '../../infrastructure/db/schema';
import { AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema';
import type { SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';

/**
 * Reads the current persisted anime snapshot before mutating it.
 * This centralizes SQLite row parsing so mutation hooks only coordinate workflow steps.
 */
export async function fetchParsedAnime(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<Anime | null> {
  const db = createDrizzleDb(rawDb);
  const [row] = await db
    .select()
    .from(animes)
    .where(eq(animes._id, animeId))
    .limit(1);

  if (!row) {
    return null;
  }

  return AnimeSchema.parse(parseStoredAnimeRow(row));
}

function parseStoredAnimeRow(row: AnimeRow) {
  return {
    ...row,
    dias: typeof row.dias === 'string' ? JSON.parse(row.dias) : (row.dias ?? []),
    generos:
      typeof row.generos === 'string'
        ? JSON.parse(row.generos)
        : (row.generos ?? []),
  };
}
