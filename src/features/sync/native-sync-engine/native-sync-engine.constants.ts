import type { NativeSyncEngineOutcome } from './native-sync-engine.types';

/**
 * Provides the registered name of the native sync-engine module, matching the `Name(...)`
 * declared by `modules/sync-engine`'s Kotlin `SyncEngineModule`.
 */
export const NATIVE_SYNC_ENGINE_MODULE_NAME = 'SyncEngine';

/**
 * The outcome values the NATIVE engine itself can report. `unavailable` is deliberately absent:
 * it is a seam-only answer for "there is no native engine on this host", never a state a
 * running attempt can reach, so a native side reporting it is treated as foreign output and
 * normalized to `failed` rather than guessed as success.
 */
export const NATIVE_OUTCOMES: readonly NativeSyncEngineOutcome[] = [
  'closed',
  'failed',
  'abandoned',
  'not_applicable',
];

/**
 * Trigger source the background task reports for engine-run attempts. The native engine journals
 * this value into its `client_telemetry`, so it must stay aligned with the JS cycle's own
 * `'background_task'` trigger (see `runBackgroundSyncCycle`) — one vocabulary for the same
 * trigger, whichever substrate executes the attempt.
 */
export const BACKGROUND_SYNC_ENGINE_TRIGGER_SOURCE = 'background_task';
