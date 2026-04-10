import { z } from 'zod';

export const AnimeStateSheetSchema = z.object({
  label: z.string().optional(),
});
