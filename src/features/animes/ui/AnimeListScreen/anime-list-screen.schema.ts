import { z } from 'zod';

/** Validates anime list screen schema payloads at runtime. */

export const AnimeListScreenSchema = z.object({
  label: z.string().optional(),
});
