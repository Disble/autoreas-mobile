import { createSyncSQLiteRuntime } from './sqlite-sync-runtime.helpers';
import { runHeadlessSyncCycle } from './headless-sync-cycle.helpers';

/**
 * Runs one headless-safe background sync cycle using a dedicated SQLite runtime.
 * The runtime is opened for the cycle and closed in a finally block so the shared UI connection
 * does not accumulate native pressure during repeated background work.
 */
export async function runBackgroundSyncCycle() {
  const runtime = createSyncSQLiteRuntime({ owner: 'headless_cycle' });

  try {
    return await runHeadlessSyncCycle({
      runtime,
      triggerSource: 'background_task',
    });
  } finally {
    await runtime.close();
  }
}
