import type { Anime } from '../../../infrastructure/validation/anime-schema';

/**
 * Normalized shape every remote->local origin (reconcile pull, WS, background headless)
 * converges to before crossing the merge boundary. Mirrors `ReconcileAnimeChange` but is
 * intentionally decoupled from the bridge wire schema so other origins can map into it.
 */
export interface RemoteAnimeChange {
  readonly recordId: string;
  readonly changeType: 'create' | 'update' | 'delete';
  readonly changedFields: readonly string[];
  readonly snapshot?: Anime;
  readonly timestamp: number;
}

/**
 * Outcome of evaluating a single `RemoteAnimeChange` against the per-anime staleness guard
 * and the outbox-protection rule. `apply` covers create/update; `delete` is its own outcome
 * so the coordinator can route it without re-deriving change_type.
 */
export type MergeDecision = 'apply' | 'delete' | 'drop_stale' | 'defer_outbox';

/**
 * Preloaded read-only context the pure decision helper needs: the per-anime guard value
 * (NULL = older than any remote change) and the set of anime ids with an unresolved local
 * outbox operation (status pending|processing).
 */
export interface MergeContext {
  readonly guardByRecordId: ReadonlyMap<string, number | null>;
  readonly pendingOutboxRecordIds: ReadonlySet<string>;
}

/**
 * Result of building a partial column update from `changed_fields` + a snapshot: only the
 * known, requested fields are included, plus the unknown field names that were skipped.
 */
export interface FieldMergeResult {
  readonly columns: Record<string, unknown>;
  readonly skippedFields: readonly string[];
}
