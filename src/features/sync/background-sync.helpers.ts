import {
  getBridgeConfigSnapshot,
  openAppDatabaseSync,
  runMigrations,
} from '../../infrastructure/db/client';
import { syncPendingOperations } from './reconcile.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';

/**
 * Runs one headless-safe background sync cycle using the shared reconcile pipeline.
 * The cycle updates the observable runtime snapshot so Settings can explain task health.
 */
export async function runBackgroundSyncCycle() {
  const rawDb = openAppDatabaseSync();

  await runMigrations(rawDb);

  const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

  if (!bridgeConfig?.deviceId) {
    return { kind: 'no_op' as const, syncedCount: 0 };
  }

  const attemptedAt = Date.now();

  await recordSyncAttemptStarted(rawDb, 'background_task', attemptedAt);

  try {
    const syncedCount = await syncPendingOperations(rawDb);

    await recordSyncAttemptSucceeded(rawDb, 'background_task', attemptedAt, syncedCount);

    return { kind: 'success' as const, syncedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Background sync failed';

    await recordSyncAttemptFailed(rawDb, 'background_task', attemptedAt, message);

    return { kind: 'failed' as const, syncedCount: 0 };
  }
}
