import { z } from 'zod';
import { EpisodeLengthSchema, type EpisodeLength } from './anime.schema';

/**
 * Serializes per-episode durations into the canonical text the `animes.episodes` column stores:
 * entry keys in the order `episode, minutes, long`, and `null` when no durations are known
 * (absent, `null` or empty). The native engine writes the same bytes, so the foreground resync's
 * text comparison never sees a difference that is only formatting.
 */
export function serializeEpisodeLengths(
  episodes: readonly EpisodeLength[] | null | undefined,
): string | null {
  if (!episodes || episodes.length === 0) {
    return null;
  }

  return JSON.stringify(
    episodes.map(({ episode, minutes, long }) => ({ episode, minutes, long })),
  );
}

/**
 * Reads the `animes.episodes` column back into entries. A NULL column, text that is not JSON, or
 * JSON that breaks the contract all read as `null` (no durations) instead of throwing.
 */
export function parseStoredEpisodeLengths(value: string | null): EpisodeLength[] | null {
  if (value === null) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(value) as unknown;
  } catch {
    return null;
  }

  const parsed = z.array(EpisodeLengthSchema).safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}
