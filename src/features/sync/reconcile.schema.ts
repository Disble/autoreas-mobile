import { z } from 'zod';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';

const ReconcileArrayFallback = <TSchema extends z.ZodTypeAny>(itemSchema: TSchema) =>
  z.array(itemSchema).nullish().transform((value) => value ?? []);

export const ReconcileAnimeChangeSchema = z.object({
  record_id: z.string(),
  change_type: z.enum(['create', 'update', 'delete']),
  changed_fields: ReconcileArrayFallback(z.string()),
  snapshot: AnimeSchema.optional(),
  timestamp: z.number(),
});

export const ReconcileAppliedOperationSchema = z.object({
  anime_id: z.string(),
  operation: z.string(),
  applied: z.boolean(),
});

export const ReconcileResponseSchema = z.object({
  status: z.string(),
  applied_operations: ReconcileArrayFallback(ReconcileAppliedOperationSchema),
  bridge_changes: ReconcileArrayFallback(ReconcileAnimeChangeSchema),
  conflicts: ReconcileArrayFallback(z.unknown()),
  last_changelog_id: z.number().optional(),
});

export type ReconcileAppliedOperation = z.infer<typeof ReconcileAppliedOperationSchema>;
export type ReconcileAnimeChange = z.infer<typeof ReconcileAnimeChangeSchema>;
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;
