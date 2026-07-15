import { z } from 'zod';

/** Validates anime tabs layout schema payloads at runtime. */

export const AnimeTabsLayoutSchema = z.object({
  label: z.string().optional(),
});
