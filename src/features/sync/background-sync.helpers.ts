import { withDeadline } from '../../infrastructure/async/deadline.helpers';
import {
  BACKGROUND_SYNC_CYCLE_DEADLINE_MS,
  BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS,
} from './background-sync.constants';
import { createSyncSQLiteRuntime } from './sqlite-sync-runtime.helpers';
import { runHeadlessSyncCycle } from './headless-sync-cycle.helpers';
import { withExclusiveSyncCycle } from './sync-cycle-lock.helpers';
import type { HeadlessSyncCycleResult } from './headless-sync-cycle.types';
import { SchemaNotReadyError } from '../../infrastructure/db/startup/startup.errors';
import type {
  BackgroundTaskOutcome,
  ResolveBackgroundTaskOutcomeParams,
} from './background-sync.types';

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
        // The deadline wraps `run`, not the `withExclusiveSyncCycle` call: the rejection must
        // propagate THROUGH the lock helper so its finally still releases the lock. Wrapping the
        // outer call would orphan the release and leave the lock to expire on its lease instead.
        result = await withDeadline({
          operation: async () =>
            runHeadlessSyncCycle({ runtime, triggerSource: 'background_task' }),
          timeoutMs: BACKGROUND_SYNC_CYCLE_DEADLINE_MS,
          label: 'background_sync_cycle',
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

/**
 * Resolves one background task run to a terminal outcome, ALWAYS. It never rejects and never
 * hangs, because its only caller is the `defineTask` callback and that callback's return value
 * is what completes the host's `CompletableDeferred`.
 *
 * This is the half of R8 that actually breaks H06h's loop. `expo-background-task`'s
 * `BackgroundTaskScheduler` awaits a deferred that an un-signalled JS task never completes, and
 * `tasks.awaitAll()` then suspends until the platform kills the job at its runtime limit and
 * re-enqueues it with no backoff. Bounding the request alone shortens the first leg; only
 * guaranteeing a signal ends the cycle.
 *
 * The deadline wraps the WHOLE call, so a stall in runtime open or in the `finally` close is
 * covered too -- those sit outside the cycle's own deadline.
 */
export async function resolveBackgroundTaskOutcome({
  runCycle,
  timeoutMs = BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS,
}: ResolveBackgroundTaskOutcomeParams): Promise<BackgroundTaskOutcome> {
  try {
    await withDeadline({
      operation: async () => runCycle(),
      timeoutMs,
      label: 'background_sync_task_signal',
    });

    return 'success';
  } catch {
    // Every failure shape collapses to one outcome on purpose: a deadline, a thrown cycle and a
    // synchronous throw are all "this run did not succeed", and the host has only two answers.
    return 'failed';
  }
}
