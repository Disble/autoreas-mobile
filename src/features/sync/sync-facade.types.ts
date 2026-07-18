import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import type { SyncConnectionStatus } from './sync-connection-store/sync-connection-store.types';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';

/** Defines the coordinated foreground sync cycle dependencies. */
export interface RunCoordinatedForegroundSyncCycleInput {
  readonly rawDb: SQLiteDatabase;
  readonly source: SyncRuntimeTriggerSource;
  readonly setActiveSeasonSnapshot: (snapshot: ActiveSeasonSnapshot | null) => void;
}

/** Defines the data contract for use sync facade result. */
export interface UseSyncFacadeResult {
  readonly connectionStatus: SyncConnectionStatus;
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
  readonly requestSync: (source: SyncRuntimeTriggerSource) => Promise<number>;
  readonly syncError: string | null;
  readonly manualSync: () => Promise<number>;
}
