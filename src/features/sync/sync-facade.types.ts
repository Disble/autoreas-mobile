import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import type { SyncConnectionStatus } from './sync-connection-store/sync-connection-store.types';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';
import type { OptionalLiveQueryStatus } from '../../infrastructure/db/native-runtime/native-runtime.types';

/**
 * Defines what one facade instance knows about its own sync prerequisites.
 * `unknown` is a first-class answer: it means this instance has not read the bridge config yet,
 * which is not the same as having read that no bridge is paired.
 */
export type SyncPrerequisiteVerdict = 'ready' | 'unknown' | 'missing';

/** Defines the prerequisite facts one facade instance can observe about itself. */
export interface ResolveSyncPrerequisitesInput {
  readonly hasDatabase: boolean;
  readonly configStatus: OptionalLiveQueryStatus;
  readonly isConfigured: boolean;
}

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
