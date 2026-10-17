import {
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
} from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';
import type { ReconcileAnimeChange } from './reconcile.schema';

/**
 * Normalizes a wire-shape `ReconcileAnimeChange` into the merge boundary's `RemoteAnimeChange`
 * DTO. Reconcile is the "rich" entry shape (carries `changed_fields` + `timestamp` always).
 * Field names this build does not know are dropped, never guessed at.
 */
export function normalizeBridgeChange(change: ReconcileAnimeChange): RemoteAnimeChange {
  return {
    recordId: change.record_id,
    changeType: change.change_type,
    changedFields: normalizeWireAnimeChangedFields(change.changed_fields),
    snapshot: change.snapshot ? mapWireAnimeToLegacyAnime(change.snapshot) : undefined,
    timestamp: change.timestamp,
  };
}
