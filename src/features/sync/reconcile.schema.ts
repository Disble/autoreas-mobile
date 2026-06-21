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

// NOTE (Conflict Honesty, see spec): remote->local resolution is deterministic field-level
// last-writer-wins, guarded by the per-anime `last_applied_change_ms` staleness guard and
// protected by the local outbox (see merge/merge-decision.helpers.ts). Ties (equal timestamp)
// keep the local row; the incoming change is dropped. The bridge may still send a `conflicts`
// field, but mobile never types or branches on it -- there is no real cross-repo conflict
// detection to act on, and presenting one would be dead scaffolding. Any such field is
// silently stripped by zod's default unknown-key handling.
export const ReconcileResponseSchema = z.object({
  status: z.string(),
  applied_operations: ReconcileArrayFallback(ReconcileAppliedOperationSchema),
  bridge_changes: ReconcileArrayFallback(ReconcileAnimeChangeSchema),
  last_changelog_id: z.number().optional(),
});

export type ReconcileAppliedOperation = z.infer<typeof ReconcileAppliedOperationSchema>;
export type ReconcileAnimeChange = z.infer<typeof ReconcileAnimeChangeSchema>;
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;
