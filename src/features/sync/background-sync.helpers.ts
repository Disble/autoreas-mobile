import { createSyncSQLiteRuntime } from './sqlite-sync-runtime.helpers';
import { runHeadlessSyncCycle } from './headless-sync-cycle.helpers';
import { withExclusiveSyncCycle } from './sync-cycle-lock.helpers';
import type { HeadlessSyncCycleResult } from './headless-sync-cycle.types';
import { SchemaNotReadyError } from '../../infrastructure/db/startup/startup.errors';

/**
 * Runs one headless-safe background sync cycle using a dedicated SQLite runtime.
 * The runtime is opened for the cycle and closed in a finally block so the shared UI connection
 * does not accumulate native pressure during repeated background work. The cycle is guarded by
 * `withExclusiveSyncCycle` so it never overlaps a concurrently in-flight FGS tick cycle on the
 * same database; when the lock is already held, this reports a no-op instead of running a
 * redundant reconcile pass.
 */
export async function runBackgroundSyncCycle(): Promise<HeadlessSyncCycleResult> {
  const runtime = createSyncSQLiteRuntime({ owner: 'headless_cycle' });

  try {
    const rawDb = await runtime.open();
    let result: HeadlessSyncCycleResult = { kind: 'no_op', syncedCount: 0 };

    await withExclusiveSyncCycle({
      rawDb,
      owner: 'headless_cycle',
      run: async () => {
        result = await runHeadlessSyncCycle({
          runtime,
          triggerSource: 'background_task',
        });
      },
    });

    return result;
  } catch (error) {
    if (error instanceof SchemaNotReadyError) {
      return { kind: 'no_op', syncedCount: 0 };
    }

    throw error;
  } finally {
    await runtime.close();
  }
}
