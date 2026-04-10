import { z } from 'zod';

export const AnimeFilterRailSchema = z.object({
  label: z.string().optional(),
});
