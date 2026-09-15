import type { SQLiteDatabase } from 'expo-sqlite';
import { hydrateCoverUris, runCoverSweep } from './cover-sweep/cover-sweep.helpers';
import { resyncFromBridgeSnapshot } from './full-resync.helpers';
import { recordDiagnosticEvent } from './sync-diagnostic-store/sync-diagnostic-store.helpers';
import { causeFromError } from './sync-telemetry.helpers';

/**
 * Runs one foreground resync cycle: start hydrating the offline cover store from disk, heal local
 * anime rows against the bridge snapshot, then sweep for cover updates. Every stage is
 * independent of the others' outcome. `resyncFromBridgeSnapshot` failing never blocks the cover
 * sweep, and neither the resync nor the sweep ever throws out of this function, so
 * `useForegroundResync`'s effects never need their own try/catch.
 */
export async function runForegroundResyncCycle(rawDb: SQLiteDatabase | null): Promise<void> {
  if (!rawDb) {
    return;
  }

  // Started, not awaited: the hydrate queues on the cover-store mutex and can sit behind a sweep
  // that is still downloading images, and chapter data must never wait for that. It never
  // rejects, and the sweep below queues behind it on the same mutex.
  void hydrateCoverUris();

  try {
    await resyncFromBridgeSnapshot(rawDb);
  } catch (error: unknown) {
    console.warn('[useForegroundResync] Resync failed', error);
    // This path is outside any sync cycle, so the cycle post-mortem never sees it: without
    // this the bridge cannot tell "the app never resynced" from "the app never opened".
    recordDiagnosticEvent({
      source: 'foreground_resync',
      event: 'resync_failed',
      cause: causeFromError(error),
      at: Date.now(),
    });
  }

  try {
    await runCoverSweep(rawDb);
  } catch (error: unknown) {
    console.warn('[useForegroundResync] Cover sweep failed', error);
  }
}
