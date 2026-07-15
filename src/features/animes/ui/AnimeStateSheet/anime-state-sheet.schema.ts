import { z } from 'zod';

/** Validates anime state sheet schema payloads at runtime. */

export const AnimeStateSheetSchema = z.object({
  label: z.string().optional(),
});
