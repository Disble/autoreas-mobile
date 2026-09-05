import { z } from 'zod';
import { WireAnimeSchema } from '../../infrastructure/validation/anime-schema/anime.schema';
import { ReconcileArrayFallback } from './reconcile-schema.helpers';

/** Validates reconcile anime change schema payloads at runtime. */

const ReconcileAnimeChangeSchema = z.object({
  record_id: z.string(),
  change_type: z.enum(['create', 'update', 'delete']),
  changed_fields: ReconcileArrayFallback(z.string()),
  snapshot: WireAnimeSchema.optional(),
  timestamp: z.number(),
});

/** Validates reconcile applied operation schema payloads at runtime. */

const ReconcileAppliedOperationSchema = z.object({
  anime_id: z.string(),
  operation: z.string(),
  applied: z.boolean(),
  // Bridge-authored OCC token confirmed for this operation. PRESENCE, not truthiness: a parsed
  // `0` and a parsed absent key must stay distinguishable, because `0` is a real, legitimate
  // token (see `collectConfirmedAnimeTokens`, which reads this field).
  modified_at: z.number().int().optional(),
  // Present only when `applied: false`. Deliberately `z.string().optional()`, NOT a `z.enum` of
  // the two known members (`conflict`, `unsupported_operation`): the closed vocabulary is
  // enforced at the CLASSIFICATION layer (`reconcile-conflict.helpers.ts`), never at parse time --
  // an `z.enum` would abort the ENTIRE response's parse the day the bridge ships a third value,
  // rather than letting that one operation be surfaced as unrecognized (spec Requirement
  // "Unrecognized Reason Is Surfaced, Never Classified").
  reason: z.string().optional(),
});

// NOTE (Conflict Honesty, see spec): remote->local resolution is deterministic field-level
// last-writer-wins, guarded by the per-anime `last_applied_change_ms` staleness guard and
// protected by the local outbox (see merge/merge-decision.helpers.ts). Ties (equal timestamp)
// keep the local row; the incoming change is dropped. The bridge may still send a `conflicts`
// field, but mobile never types or branches on it -- there is no real cross-repo conflict
// detection to act on, and presenting one would be dead scaffolding. Any such field is
// silently stripped by zod's default unknown-key handling.
/** Validates reconcile response schema payloads at runtime. */
export const ReconcileResponseSchema = z.object({
  status: z.string(),
  applied_operations: ReconcileArrayFallback(ReconcileAppliedOperationSchema),
  bridge_changes: ReconcileArrayFallback(ReconcileAnimeChangeSchema),
  last_changelog_id: z.number().optional(),
});

/** Defines the reconcile applied operation value shape. */
export type ReconcileAppliedOperation = z.infer<typeof ReconcileAppliedOperationSchema>;
/** Defines the reconcile anime change value shape. */
export type ReconcileAnimeChange = z.infer<typeof ReconcileAnimeChangeSchema>;
