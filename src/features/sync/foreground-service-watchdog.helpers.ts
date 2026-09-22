import type { SQLiteDatabase } from 'expo-sqlite';
import { withDeadline } from '../../infrastructure/async/deadline.helpers';
import { FOREGROUND_SERVICE_WATCHDOG_DEADLINE_MS } from './foreground-service-watchdog.constants';
import { createNativeBatteryOptimizationExemption } from './native-battery-optimization.helpers';
import { createNativeForegroundServicePresence } from './native-foreground-service-presence.helpers';
import { createNotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter';
import { NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from './notifee-foreground-service-adapter/notifee-foreground-service-adapter.constants';
import { createSyncSQLiteRuntime } from './sqlite-sync-runtime.helpers';
import {
  getSyncRuntimeStatusSnapshot,
  updateSyncRuntimeStatusSnapshot,
} from './sync-runtime-status.helpers';
import type {
  ForegroundServiceWatchdogDecision,
  ForegroundServiceWatchdogOutcome,
  ResolveForegroundServiceWatchdogDecisionParams,
} from './foreground-service-watchdog.types';

/**
 * Decides what a headless-wake FGS watchdog should do, from three already-resolved facts. Pure:
 * no SQLite, no Notifee, no native module lookups -- every side-effecting read lives in the
 * caller, so this function is the whole testable surface for the watchdog's judgment call.
 *
 * Order matters and is deliberate:
 * 1. `executionMode` is checked first. An app never configured for FGS mode has nothing to
 *    watch, regardless of what the other two flags say -- a stale or degraded presence/exemption
 *    read must not manufacture a decision for a mode the app was never in.
 * 2. `isForegroundServiceRunning` is checked next. If the native check confirms the service is
 *    actually up, that settles it -- exemption is irrelevant to a service that is already
 *    running, and restoring it here would risk the disaster this decision exists to prevent (see
 *    the rejected "just call `register()` blindly" shortcut in `runForegroundServiceWatchdog`'s
 *    doc comment).
 * 3. Only once the service is confirmed down does `isExempt` decide between attempting a legal
 *    restore and recording why one was not attempted -- a background `startForegroundService`
 *    throws `ForegroundServiceStartNotAllowedException` without the exemption, and an
 *    attempted-and-crashed restore inside a headless task is strictly worse than a skipped one.
 */
export function resolveForegroundServiceWatchdogDecision({
  executionMode,
  isForegroundServiceRunning,
  isExempt,
}: ResolveForegroundServiceWatchdogDecisionParams): ForegroundServiceWatchdogDecision {
  if (executionMode !== 'android_foreground_service') {
    return 'not_configured';
  }

  if (isForegroundServiceRunning) {
    return 'already_running';
  }

  if (!isExempt) {
    return 'blocked_not_exempt';
  }

  return 'restore';
}

/**
 * Best-effort write of a freshly-confirmed native presence reading back into the persisted
 * `sync_runtime_status.isForegroundServiceRunning` column. This is what makes the watchdog
 * self-healing: that column is the exact flag that goes stale in the background (it is written
 * only by the live foreground runtime), and the watchdog is the one caller with real ground
 * truth, from the native check, to correct it during a headless wake. Swallows its own failure
 * -- a DB write hiccup while recording the outcome must not reclassify an otherwise-successful
 * decision as an error.
 */
async function recordForegroundServiceRunning(
  rawDb: SQLiteDatabase,
  isForegroundServiceRunning: boolean,
): Promise<void> {
  try {
    await updateSyncRuntimeStatusSnapshot(rawDb, { isForegroundServiceRunning });
  } catch (error) {
    console.warn(
      '[runForegroundServiceWatchdog] Failed to persist the corrected presence state',
      error,
    );
  }
}

/**
 * Attempts the actual restore through the existing JS path, `adapter.register()` -- the only
 * legal way to bring Notifee's foreground service back up (see this module's rejected-shortcut
 * note below for why a fresh adapter's `register()` is NOT already idempotent enough for this to
 * be called unconditionally). A thrown restore is recorded and swallowed here, never propagated.
 */
async function restoreForegroundService(rawDb: SQLiteDatabase): Promise<ForegroundServiceWatchdogOutcome> {
  try {
    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();
    await recordForegroundServiceRunning(rawDb, true);
    return 'restored';
  } catch (error) {
    console.warn('[runForegroundServiceWatchdog] Restore attempt failed', error);
    // The native presence check that led to this branch already confirmed the service was down
    // moments earlier in this same wake; re-affirming `false` here repeats that already-true
    // fact rather than fabricating a new claim about the post-attempt state.
    await recordForegroundServiceRunning(rawDb, false);
    return 'restore_failed';
  }
}

/**
 * Runs one FGS watchdog check on a headless background wake. When it settles, it ALWAYS resolves
 * to a recorded outcome, never a rejection -- but on this specific path it is NOT guaranteed to
 * settle at all, and that distinction is load-bearing, not pedantic.
 *
 * `withDeadline` below wraps the work, and it is a real bound in a foreground/live-timer context.
 * It is NOT a real bound here. Device-confirmed 2026-09-04 (`background-timers-paused-headless`):
 * JS timers stop running inside this headless `expo-background-task` cycle once any cycle fails
 * to signal completion -- RN's `JavaTimerManager` pauses `setTimeout` with the Activity, and
 * `expo-task-manager`'s `TaskService.java` keep-alive re-registration only fires on the first
 * event of `sEvents`, so one un-signalled cycle poisons every later cycle's timers too. The
 * plausible hang here is `adapter.register()`: the ordering note above
 * `notifee.displayNotification` in `notifee-foreground-service-adapter.helpers.ts` documents that
 * code after that await may never run once the process is handed to Notifee's headless context.
 * See `FOREGROUND_SERVICE_WATCHDOG_DEADLINE_MS`'s own doc comment for the full reasoning and why
 * the constant stays anyway.
 *
 * Because a hang here is real and the deadline cannot be trusted to end it, `background-sync.task.ts`
 * never awaits this function -- `void runForegroundServiceWatchdog().catch(() => undefined)`. That
 * is the actual guarantee: structural, not timer-based. The SQLite awaits inside this function
 * (`runtime.open()`, the snapshot read, the status-patch writes) are each bounded natively by
 * `busy_timeout`, independent of the JS event loop; only `adapter.register()` has no native bound,
 * which is exactly why the caller not awaiting is what matters, not this deadline.
 *
 * The three facts `resolveForegroundServiceWatchdogDecision` needs are read fresh, every call:
 * the persisted `executionMode` (is the app supposed to be in FGS mode), the native presence
 * check (is the service actually up right now), and the native battery-optimization exemption
 * (is a background restore legal at all). A `restore` decision goes through
 * `restoreForegroundService`; every other decision is either a no-op or an intentional skip, and
 * both still correct the persisted `isForegroundServiceRunning` flag with the fresh native
 * reading before returning.
 *
 * **Rejected shortcut, recorded because it is the tempting one:** "just call `register()`
 * blindly, it is idempotent". It is not, across a fresh headless process. A fresh adapter
 * instance's `isRunning()` (both the runner's and the ticker's) is plain JS closure state that
 * always starts at `false`, so an unconditional `register()` would start a SECOND runner even
 * when the real service is already up. The ticker survives that only by accident -- native
 * `startTicking()` calls `stopTicking()` first and the alarm `PendingIntent` reuses one request
 * code -- and a duplicate runner's cycles are serialized only by the pre-existing
 * `withExclusiveSyncCycle` lease. Two accidental protections, neither put there for this
 * purpose, is luck rather than design. That is why this function checks first.
 */
export async function runForegroundServiceWatchdog(): Promise<ForegroundServiceWatchdogOutcome> {
  const runtime = createSyncSQLiteRuntime({ owner: 'foreground_service_watchdog' });

  try {
    return await withDeadline({
      operation: async (): Promise<ForegroundServiceWatchdogOutcome> => {
        const rawDb = await runtime.open();
        const snapshot = await getSyncRuntimeStatusSnapshot(rawDb);
        const exemption = createNativeBatteryOptimizationExemption();
        const presence = createNativeForegroundServicePresence();
        const isForegroundServiceRunning = presence.isForegroundServiceRunning(
          NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
        );
        const isExempt = exemption.isExempt();

        const decision = resolveForegroundServiceWatchdogDecision({
          executionMode: snapshot.executionMode,
          isForegroundServiceRunning,
          isExempt,
        });

        switch (decision) {
          case 'not_configured':
            return 'not_configured';
          case 'already_running':
            await recordForegroundServiceRunning(rawDb, true);
            return 'already_running';
          case 'blocked_not_exempt':
            console.warn(
              '[runForegroundServiceWatchdog] Service is down and the app is not battery-exempt; skipping restore',
            );
            await recordForegroundServiceRunning(rawDb, false);
            return 'blocked_not_exempt';
          case 'restore':
            return restoreForegroundService(rawDb);
        }
      },
      timeoutMs: FOREGROUND_SERVICE_WATCHDOG_DEADLINE_MS,
      label: 'foreground_service_watchdog',
    });
  } catch (error) {
    // Every failure shape collapses to one outcome on purpose, mirroring
    // `resolveBackgroundTaskOutcome`: a deadline, a thrown native seam and a rejected DB read are
    // all "this watchdog check did not complete", and the caller only needs to know it is safe
    // to continue.
    console.warn('[runForegroundServiceWatchdog] Watchdog check failed', error);
    return 'watchdog_error';
  } finally {
    await runtime.close();
  }
}
