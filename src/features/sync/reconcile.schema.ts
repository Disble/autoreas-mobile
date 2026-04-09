import { z } from 'zod';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';

export const ReconcileAnimeChangeSchema = z.object({
  record_id: z.string(),
  change_type: z.enum(['create', 'update', 'delete']),
  changed_fields: z.array(z.string()),
  snapshot: AnimeSchema.optional(),
  timestamp: z.number(),
});

export const ReconcileResponseSchema = z.object({
  status: z.string(),
  bridge_changes: z.array(ReconcileAnimeChangeSchema),
  conflicts: z.array(z.unknown()),
});
