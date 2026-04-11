import { buildSyncExecutionStatusPatch } from '../../../src/features/sync/sync-execution-strategy.helpers';

describe('sync-execution-strategy.helpers', () => {
  it('builds a best-effort status patch without foreground service state', () => {
    expect(
      buildSyncExecutionStatusPatch({
        executionMode: 'best_effort_background_task',
        registrationStatus: 'registered',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
      }),
    ).toEqual({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
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
      }),
    ).toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
    });
  });
});
