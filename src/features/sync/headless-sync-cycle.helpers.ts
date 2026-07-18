import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { pruneOperationLog } from './operation-log-retention.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import {
  recordBacklogReadCount,
  recordCycleActive,
  recordPrunedOperationsCount,
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
 * The runtime owns the SQLite connection; this helper only borrows it for the cycle duration.
 */
export async function runHeadlessSyncCycle(
  params: RunHeadlessSyncCycleParams,
): Promise<HeadlessSyncCycleResult> {
  const rawDb = await params.runtime.open();
  const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

  if (!bridgeConfig?.deviceId) {
    return { kind: 'no_op', syncedCount: 0 };
  }

  const attemptedAt = Date.now();

  await recordSyncAttemptStarted(rawDb, params.triggerSource, attemptedAt);
  await recordCycleActive(rawDb, true);

  try {
    // The headless/background runtime opens an isolated, non-reactive connection
    // (enableChangeListener:false, useNewConnection:true). It must apply pulled bridge
    // changes in 'staged' mode so the reconcile apply step never writes `animes` directly
    // on this connection -- only the foreground drain hook writes `animes`, on the shared
    // reactive connection, where `useLiveQuery` can observe it.
    const { syncedCount, backlogReadCount } = await syncPendingOperations(rawDb, 'staged');

    await recordBacklogReadCount(rawDb, backlogReadCount);
    await recordSyncAttemptSucceeded(
      rawDb,
      params.triggerSource,
      attemptedAt,
      syncedCount,
    );

    try {
      const pruneResult = await pruneOperationLog(rawDb);

      await recordPrunedOperationsCount(rawDb, pruneResult.prunedCount);
    } catch (pruneError) {
      console.warn('[runHeadlessSyncCycle] Operation-log pruning failed', pruneError);
    }

    return { kind: 'success', syncedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Background sync failed';

    await recordSyncAttemptFailed(rawDb, params.triggerSource, attemptedAt, message);

    try {
      const pruneResult = await pruneOperationLog(rawDb);

      await recordPrunedOperationsCount(rawDb, pruneResult.prunedCount);
    } catch (pruneError) {
      console.warn('[runHeadlessSyncCycle] Operation-log pruning failed', pruneError);
    }

    return { kind: 'failed', syncedCount: 0 };
  } finally {
    await recordCycleActive(rawDb, false);
  }
}
