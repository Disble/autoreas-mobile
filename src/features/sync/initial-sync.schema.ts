import { WireAnimeListSchema } from '../../infrastructure/validation/anime-schema/anime.schema';
import { mapWireAnimeListToLegacyAnimes } from '../../infrastructure/validation/anime-schema/anime-wire.helpers';

/** Validates anime list schema payloads at runtime. */

export const AnimeListSchema = WireAnimeListSchema.transform(mapWireAnimeListToLegacyAnimes);
