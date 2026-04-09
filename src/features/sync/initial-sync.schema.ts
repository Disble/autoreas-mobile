import { z } from 'zod';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';

export const AnimeListSchema = z.array(AnimeSchema);

export const IncrementalChangeSchema = z.object({
  record_id: z.string(),
  change_type: z.enum(['create', 'update', 'delete']),
  snapshot: AnimeSchema.optional(),
});

export const IncrementalChangesResponseSchema = z.object({
  changes: z.array(IncrementalChangeSchema).default([]),
  last_changelog_id: z.number().default(0),
});

export type IncrementalChange = z.infer<typeof IncrementalChangeSchema>;
