import { z } from 'zod';

export const AnimeListScreenSchema = z.object({
  label: z.string().optional(),
});
