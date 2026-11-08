import type { SQLiteDatabase } from 'expo-sqlite';
import type { NativeSyncDiary } from './native-foreground-sync-ticker.types';

/** A connectivity change as the sync diary names it: `started` when it came back, `stopped` when it went away. */
export type SyncRuntimeNetworkTransition = 'started' | 'stopped';

/** One connectivity change to record, with the database whose bridge config holds the user's switch. */
export interface RecordNetworkTransitionInput {
  readonly rawDb: SQLiteDatabase | null;
  readonly transition: SyncRuntimeNetworkTransition;
}

/** Collaborators of the network transition recorder; each defaults to the production one. */
export interface RecordNetworkTransitionDeps {
  /** Reads the bridge config whose switch gates the record; defaults to `getBridgeConfigSnapshot`. */
  readonly readConfig?: (
    rawDb: SQLiteDatabase,
  ) => Promise<{ isSyncTelemetryEnabled?: unknown } | null>;
  /** The native diary; defaults to `createNativeSyncDiary()`. */
  readonly diary?: Pick<NativeSyncDiary, 'recordRuntimeTransition'>;
  /** The accepted-kind decision; defaults to `isSyncDiagnosticsPayloadAccepted`. */
  readonly isAccepted?: (payload: unknown) => boolean;
}
