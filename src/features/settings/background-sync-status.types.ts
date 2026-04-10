import type { SyncRuntimeStatusSnapshot } from '../sync/sync-runtime-status.types';

export interface UseBackgroundSyncStatusResult {
  readonly snapshot: SyncRuntimeStatusSnapshot;
}
