import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

/** Defines the data contract for sync bootstrap context. */
export interface SyncBootstrapContext {
  readonly rawDb: SQLiteDatabase;
}

/** Defines the sync bootstrap strategy value shape. */
export type SyncBootstrapStrategy = (
  context: SyncBootstrapContext,
) => Promise<number>;

/** Defines the sync bootstrap mode value shape. */
export type SyncBootstrapMode = 'hydrate' | 'reconcile';

/** Defines the sync state value shape. */
export type SyncState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'online'; readonly lastSyncAt: number }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly message: string };

/** Defines the sync event value shape. */
export type SyncEvent =
  | { readonly type: 'MARK_OFFLINE' }
  | { readonly type: 'SYNC_STARTED' }
  | { readonly type: 'SYNC_SUCCEEDED'; readonly syncedAt: number }
  | { readonly type: 'SYNC_FAILED'; readonly message: string };

/** Defines the data contract for use sync facade result. */
export interface UseSyncFacadeResult {
  readonly connectionStatus: SyncState['kind'];
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
  readonly requestSync: (source: SyncRuntimeTriggerSource) => Promise<number>;
  readonly syncError: string | null;
  readonly manualSync: () => Promise<number>;
}
