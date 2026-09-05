import { WireAnimeListSchema } from '../../infrastructure/validation/anime-schema/anime.schema';
import { mapWireAnimeToIngestedAnime } from '../../infrastructure/validation/anime-schema/anime-wire.helpers';

/**
 * Validates anime list schema payloads at runtime and transforms them into `IngestedAnime[]` --
 * the domain `Anime` paired with its bridge OCC token, never the domain shape alone (invariant
 * 5: the token must never reach `Anime`/`AnimeSchema`).
 */
export const AnimeListSchema = WireAnimeListSchema.transform((wireAnimes) =>
  wireAnimes.map(mapWireAnimeToIngestedAnime),
);
