import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

export interface SyncBootstrapContext {
  readonly rawDb: SQLiteDatabase;
}

export type SyncBootstrapStrategy = (
  context: SyncBootstrapContext,
) => Promise<number>;

export type SyncBootstrapMode = 'hydrate' | 'reconcile';

export type SyncState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'online'; readonly lastSyncAt: number }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error'; readonly message: string };

export type SyncEvent =
  | { readonly type: 'MARK_OFFLINE' }
  | { readonly type: 'SYNC_STARTED' }
  | { readonly type: 'SYNC_SUCCEEDED'; readonly syncedAt: number }
  | { readonly type: 'SYNC_FAILED'; readonly message: string };

export interface UseSyncFacadeResult {
  readonly connectionStatus: SyncState['kind'];
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
  readonly requestSync: (source: SyncRuntimeTriggerSource) => Promise<number>;
  readonly syncError: string | null;
  readonly manualSync: () => Promise<number>;
}
