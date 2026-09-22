import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import {
  BACKGROUND_SYNC_TASK_NAME,
  BACKGROUND_SYNC_TASK_OPTIONS,
} from "./background-sync.constants";
import {
  resolveBackgroundTaskOutcome,
  runBackgroundSyncCycle,
} from "./background-sync.helpers";
import { runForegroundServiceWatchdog } from "./foreground-service-watchdog.helpers";

try {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
    // This callback's return value is what completes the host's CompletableDeferred. A cycle
    // that never settles leaves it uncompleted, `tasks.awaitAll()` suspends, and the platform
    // kills the job at its runtime limit and re-enqueues it -- H06h's loop. So the decision of
    // WHETHER this settles lives in `resolveBackgroundTaskOutcome`, which cannot hang or throw;
    // all that remains here is mapping its outcome onto the Expo enum.
    // Routed through the native engine when it is available (its own connections, lease owner
    // and 30 s native watchdog — no JS timer on this path), falling back to the existing JS
    // cycle otherwise until the migration retires it (ODD T8). Either way the attempt resolves;
    // the decision of WHETHER this settles lives in `resolveBackgroundTaskOutcome`, which cannot
    // hang or throw; all that remains here is mapping its outcome onto the Expo enum.
    const outcome = await resolveBackgroundTaskOutcome({
      runCycle: runBackgroundSyncCycle,
    });

    // Rides this same headless wake rather than adding a second scheduler -- this WorkManager
    // job is the only vehicle in this app that can legally call back into Notifee from the
    // background. Deliberately NOT awaited. `adapter.register()` (inside the watchdog) can hang
    // forever on this path: the ordering note above `notifee.displayNotification` in
    // notifee-foreground-service-adapter.helpers.ts documents that code after that await may
    // never run once the process is handed to Notifee's headless context. Worse, the JS-level
    // deadline inside `runForegroundServiceWatchdog` cannot be trusted to rescue that hang here --
    // see its own doc comment for the device-confirmed reason (2026-09-04): JS timers do not run
    // in this headless cycle once a cycle fails to signal, and only native bounds fire. Awaiting a
    // hang here would leave this callback's `CompletableDeferred` uncompleted, which is exactly
    // H06h's loop -- the one `resolveBackgroundTaskOutcome` above exists to break. Firing without
    // awaiting is what actually guarantees this callback still returns: that guarantee comes from
    // structure, not from any timer firing. If the runtime tears down mid-`register()`, that is
    // acceptable: the native ticker persists its own state (T2+T3), so the next wake's watchdog
    // sees the service still down and retries. `.catch()` only silences an eventual unhandled
    // rejection; it does nothing for a promise that never settles at all.
    void runForegroundServiceWatchdog().catch(() => undefined);

    return outcome === "success"
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  });
} catch {
  // Expo may re-evaluate this module during tests or fast refresh.
}

/** Executes the register background sync task operation. */
export async function registerBackgroundSyncTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_SYNC_TASK_NAME,
  );

  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(
      BACKGROUND_SYNC_TASK_NAME,
      BACKGROUND_SYNC_TASK_OPTIONS,
    );
  }
}

/** Executes the unregister background sync task operation. */
export async function unregisterBackgroundSyncTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_SYNC_TASK_NAME,
  );

  if (isRegistered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK_NAME);
  }
}

/** Executes the is background sync task registered operation. */
export async function isBackgroundSyncTaskRegistered() {
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME);
}
