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

try {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
    // This callback's return value is what completes the host's CompletableDeferred. A cycle
    // that never settles leaves it uncompleted, `tasks.awaitAll()` suspends, and the platform
    // kills the job at its runtime limit and re-enqueues it -- H06h's loop. So the decision of
    // WHETHER this settles lives in `resolveBackgroundTaskOutcome`, which cannot hang or throw;
    // all that remains here is mapping its outcome onto the Expo enum.
    const outcome = await resolveBackgroundTaskOutcome({
      runCycle: runBackgroundSyncCycle,
    });

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
