import { createNativeSyncDiary } from '../../../src/features/sync/native-sync-diary.helpers';

describe('native sync diary', () => {
  it('delegates each record to the native module, with a null reason when none is given', () => {
    const recordSyncAttempt = jest.fn().mockResolvedValue(undefined);
    const recordRuntimeTransition = jest.fn().mockResolvedValue(undefined);
    const diary = createNativeSyncDiary({
      requireOptionalNativeModule: () => ({
        start: jest.fn(),
        stop: jest.fn(),
        recordSyncAttempt,
        recordRuntimeTransition,
      }),
    });

    diary.recordSyncAttempt('manual', 'closed', 120);
    diary.recordRuntimeTransition('network', 'started');
    diary.recordRuntimeTransition('network', 'stopped', 'airplane_mode');

    expect(recordSyncAttempt).toHaveBeenCalledWith('manual', 'closed', 120);
    expect(recordRuntimeTransition.mock.calls).toEqual([
      ['network', 'started', null],
      ['network', 'stopped', 'airplane_mode'],
    ]);
  });

  it('is a no-op when the native module is missing or predates the diary', () => {
    const missing = createNativeSyncDiary({ requireOptionalNativeModule: () => null });
    const older = createNativeSyncDiary({
      requireOptionalNativeModule: () => ({ start: jest.fn(), stop: jest.fn() }),
    });

    for (const diary of [missing, older]) {
      expect(() => diary.recordSyncAttempt('manual', 'closed', 1)).not.toThrow();
      expect(() => diary.recordRuntimeTransition('network', 'started')).not.toThrow();
    }
  });

  it('swallows a native call that throws or rejects', async () => {
    const rejection = Promise.reject(new Error('sqlite busy'));
    const handleRejection = jest.spyOn(rejection, 'catch');
    const rejected = jest.fn(() => rejection);
    const thrown = jest.fn(() => {
      throw new Error('bridge gone');
    });
    const diary = createNativeSyncDiary({
      requireOptionalNativeModule: () => ({
        start: jest.fn(),
        stop: jest.fn(),
        recordSyncAttempt: rejected,
        recordRuntimeTransition: thrown,
      }),
    });

    expect(() => diary.recordSyncAttempt('manual', 'closed', 1)).not.toThrow();
    expect(() => diary.recordRuntimeTransition('network', 'started')).not.toThrow();
    // The rejection is handled, so it never surfaces as an unhandled rejection.
    expect(handleRejection).toHaveBeenCalledTimes(1);
    await expect(rejection).rejects.toThrow('sqlite busy');
  });
});
