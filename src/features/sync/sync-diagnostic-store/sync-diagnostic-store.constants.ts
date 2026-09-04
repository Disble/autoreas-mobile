import type { SyncDiagnosticEvent } from '../sync-diagnostic-events.types';

/**
 * Holds the diagnostic ring in MEMORY, deliberately.
 *
 * Persisting each observation would put instrumentation on the shared write door -- the exact
 * component whose jamming this feed exists to report on, which is how a measuring device becomes
 * the fault it measures. Losing the ring when the process dies costs little: the one thing a dead
 * process needs to report is its own death, and the persisted cycle checkpoint already carries
 * that.
 */
export const SYNC_DIAGNOSTIC_RING_STATE: { current: readonly SyncDiagnosticEvent[] } = {
  current: [],
};
