import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {
  BACKGROUND_SYNC_TASK_NAME,
  BACKGROUND_SYNC_TASK_OPTIONS,
} from './background-sync.constants';
import { runBackgroundSyncCycle } from './background-sync.helpers';

try {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
    try {
      const result = await runBackgroundSyncCycle();

      return result.kind === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch {
  // Expo may re-evaluate this module during tests or fast refresh.
}

export async function registerBackgroundSyncTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME);

  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(
      BACKGROUND_SYNC_TASK_NAME,
      BACKGROUND_SYNC_TASK_OPTIONS,
    );
  }
}

export async function unregisterBackgroundSyncTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME);

  if (isRegistered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK_NAME);
  }
}

export async function isBackgroundSyncTaskRegistered() {
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME);
}
