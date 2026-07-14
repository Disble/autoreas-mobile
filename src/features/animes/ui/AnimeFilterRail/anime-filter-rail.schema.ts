import { z } from 'zod';

/** Validates anime filter rail schema payloads at runtime. */

export const AnimeFilterRailSchema = z.object({
  label: z.string().optional(),
});
