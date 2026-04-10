import {
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
} from '../../../src/features/sync/sync-runtime-status.helpers';

describe('sync runtime status helpers', () => {
  it('createEmptySyncRuntimeStatusSnapshot retorna el snapshot neutral esperado', () => {
    expect(createEmptySyncRuntimeStatusSnapshot()).toEqual({
      registrationStatus: 'unregistered',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureMessage: null,
      lastTriggerSource: null,
      lastSyncedCount: 0,
    });
  });

  it('buildSyncAttemptStartedPatch limpia error previo y registra trigger+attempt', () => {
    expect(buildSyncAttemptStartedPatch('background_task', 1710000000000)).toEqual({
      lastAttemptAt: 1710000000000,
      lastFailureMessage: null,
      lastTriggerSource: 'background_task',
    });
  });

  it('buildSyncAttemptSucceededPatch persiste success y syncedCount observable', () => {
    expect(buildSyncAttemptSucceededPatch('background_task', 1710000005000, 4)).toEqual({
      lastAttemptAt: 1710000005000,
      lastSuccessAt: 1710000005000,
      lastFailureMessage: null,
      lastTriggerSource: 'background_task',
      lastSyncedCount: 4,
    });
  });

  it('buildSyncAttemptFailedPatch persiste failure sin inventar success', () => {
    expect(buildSyncAttemptFailedPatch('background_task', 1710000009000, 'Network Error')).toEqual({
      lastAttemptAt: 1710000009000,
      lastFailureMessage: 'Network Error',
      lastTriggerSource: 'background_task',
    });
  });
});
