import type { SyncRuntimeStatusSnapshot } from '../sync/sync-runtime-status.types';

/** Defines the data contract for use background sync status result. */
export interface UseBackgroundSyncStatusResult {
  readonly snapshot: SyncRuntimeStatusSnapshot;
}
