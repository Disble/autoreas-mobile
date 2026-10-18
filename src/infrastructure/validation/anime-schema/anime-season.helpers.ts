import { AnimeSeasonSchema, type AnimeSeason } from './anime.schema';

/**
 * Serializes a season candidacy into the canonical text the `animes.season` column stores: keys in
 * the order `seasonId, grade`, and `null` when the anime is not a candidate. The native engine
 * writes the same bytes, so the foreground resync's text comparison never sees a difference that
 * is only formatting.
 */
export function serializeAnimeSeason(season: AnimeSeason | null | undefined): string | null {
  if (!season) {
    return null;
  }

  return JSON.stringify({ seasonId: season.seasonId, grade: season.grade });
}

/**
 * Reads the `animes.season` column back into a candidacy. A NULL column, text that is not JSON, or
 * JSON that breaks the contract all read as `null` (not a candidate) instead of throwing.
 */
export function parseStoredAnimeSeason(value: string | null): AnimeSeason | null {
  if (value === null) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(value) as unknown;
  } catch {
    return null;
  }

  const parsed = AnimeSeasonSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
