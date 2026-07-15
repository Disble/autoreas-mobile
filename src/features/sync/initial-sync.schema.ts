import { z } from 'zod';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';

/** Validates anime list schema payloads at runtime. */

export const AnimeListSchema = z.array(AnimeSchema);
