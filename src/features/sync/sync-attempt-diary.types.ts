import type { SQLiteDatabase } from 'expo-sqlite';
import type { NativeSyncDiary } from './native-foreground-sync-ticker.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

/** How one JS sync attempt ended, in the hourly summary's `outcome` vocabulary. */
export type SyncAttemptDiaryOutcome = 'closed' | 'failed';

/** One finished JS sync attempt, as the diary counts it. */
export interface RecordForegroundSyncAttemptInput {
  readonly rawDb: SQLiteDatabase;
  readonly source: SyncRuntimeTriggerSource;
  readonly outcome: SyncAttemptDiaryOutcome;
  readonly durationMs: number;
}

/** Collaborators of the attempt recorder; each defaults to the production one. */
export interface RecordForegroundSyncAttemptDeps {
  /** Reads the bridge config whose switch gates the record; defaults to `getBridgeConfigSnapshot`. */
  readonly readConfig?: (
    rawDb: SQLiteDatabase,
  ) => Promise<{ isSyncTelemetryEnabled?: unknown } | null>;
  /** The native diary; defaults to `createNativeSyncDiary()`. */
  readonly diary?: Pick<NativeSyncDiary, 'recordSyncAttempt'>;
  /** The accepted-kind decision; defaults to `isSyncDiagnosticsPayloadAccepted`. */
  readonly isAccepted?: (payload: unknown) => boolean;
}
