import { getBridgeConfigSnapshot, runMigrations } from '../../infrastructure/db/client';
import { syncPendingOperations } from './reconcile.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';
import type {
  HeadlessSyncCycleResult,
  RunHeadlessSyncCycleParams,
} from './headless-sync-cycle.types';

/**
 * Runs one headless-safe sync cycle against the shared reconcile pipeline.
 * Both the Expo background task and the Android foreground service reuse this path so observability stays consistent.
 */
export async function runHeadlessSyncCycle(
  params: RunHeadlessSyncCycleParams,
): Promise<HeadlessSyncCycleResult> {
  await runMigrations(params.rawDb);

  const bridgeConfig = await getBridgeConfigSnapshot(params.rawDb);

  if (!bridgeConfig?.deviceId) {
    return { kind: 'no_op', syncedCount: 0 };
  }

  const attemptedAt = Date.now();

  await recordSyncAttemptStarted(params.rawDb, params.triggerSource, attemptedAt);

  try {
    const syncedCount = await syncPendingOperations(params.rawDb);

    await recordSyncAttemptSucceeded(
      params.rawDb,
      params.triggerSource,
      attemptedAt,
      syncedCount,
    );

    return { kind: 'success', syncedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Background sync failed';

    await recordSyncAttemptFailed(params.rawDb, params.triggerSource, attemptedAt, message);

    return { kind: 'failed', syncedCount: 0 };
  }
}
