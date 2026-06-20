import { z } from 'zod';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';

export const AnimeListSchema = z.array(AnimeSchema);
