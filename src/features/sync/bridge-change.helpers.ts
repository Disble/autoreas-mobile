import {
  findUnsupportedWireAnimeChangedFields,
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
} from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';
import type { ReconcileAnimeChange } from './reconcile.schema';
import { recordDiagnosticEvent } from './sync-diagnostic-store/sync-diagnostic-store.helpers';

/**
 * Normalizes a wire-shape `ReconcileAnimeChange` into the merge boundary's `RemoteAnimeChange`
 * DTO. Reconcile is the "rich" entry shape (carries `changed_fields` + `timestamp` always).
 * Field names this build does not know are dropped and recorded as a rejection, never guessed at.
 */
export function normalizeBridgeChange(change: ReconcileAnimeChange): RemoteAnimeChange {
  if (findUnsupportedWireAnimeChangedFields(change.changed_fields).length > 0) {
    recordDiagnosticEvent({
      source: 'sync_cycle',
      event: 'remote_change_rejected',
      cause: null,
      at: Date.now(),
    });
  }

  return {
    recordId: change.record_id,
    changeType: change.change_type,
    changedFields: normalizeWireAnimeChangedFields(change.changed_fields),
    snapshot: change.snapshot ? mapWireAnimeToLegacyAnime(change.snapshot) : undefined,
    timestamp: change.timestamp,
  };
}
