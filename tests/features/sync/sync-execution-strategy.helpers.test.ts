import { buildSyncExecutionStatusPatch } from '../../../src/features/sync/sync-execution-strategy.helpers';

describe('sync-execution-strategy.helpers', () => {
  it('builds a best-effort status patch with only the persisted registration columns', () => {
    expect(
      buildSyncExecutionStatusPatch({
        executionMode: 'best_effort_background_task',
        registrationStatus: 'registered',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: true,
      }),
    ).toEqual({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      canShowPersistentNotification: false,
    });
  });

  it('builds an android foreground-service status patch with persistent notification state', () => {
    expect(
      buildSyncExecutionStatusPatch({
        executionMode: 'android_foreground_service',
        registrationStatus: 'registered',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: false,
      }),
    ).toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      canShowPersistentNotification: true,
    });
  });

  it('never persists the live service and task flags, which nothing reads back from the row', () => {
    const patch = buildSyncExecutionStatusPatch({
      executionMode: 'android_foreground_service',
      registrationStatus: 'registered',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: true,
    });

    expect(patch).not.toHaveProperty('isForegroundServiceRunning');
    expect(patch).not.toHaveProperty('isBackgroundTaskRegistered');
  });
});
