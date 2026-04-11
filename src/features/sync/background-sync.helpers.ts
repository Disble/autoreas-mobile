import {
  openAppDatabaseSync,
} from '../../infrastructure/db/client';
import { runHeadlessSyncCycle } from './headless-sync-cycle.helpers';

/**
 * Runs one headless-safe background sync cycle using the shared reconcile pipeline.
 * The cycle updates the observable runtime snapshot so Settings can explain task health.
 */
export async function runBackgroundSyncCycle() {
  const rawDb = openAppDatabaseSync();

  return runHeadlessSyncCycle({
    rawDb,
    triggerSource: 'background_task',
  });
}
