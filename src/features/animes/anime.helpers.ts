import type { AnimeRow } from '../../infrastructure/db/schema';
import type { Anime } from '../../infrastructure/validation/anime-schema';

/**
 * Normalizes a persisted SQLite anime row into the validated domain shape used by UI hooks.
 * This keeps JSON parsing in one place so list consumers don't duplicate storage concerns.
 */
export function parseAnimeRow(row: AnimeRow): Anime {
  return {
    ...row,
    dias: row.dias ? JSON.parse(row.dias) : [],
    generos: row.generos ? JSON.parse(row.generos) : [],
  };
}
