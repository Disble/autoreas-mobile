import {
  buildSyncAttemptFailedPatch,
  buildSyncAttemptStartedPatch,
  buildSyncAttemptSucceededPatch,
  createEmptySyncRuntimeStatusSnapshot,
  withColumnDefault,
  withPatchOverride,
} from '../../../src/features/sync/sync-runtime-status.helpers';

describe('sync runtime status helpers', () => {
  it('createEmptySyncRuntimeStatusSnapshot retorna el snapshot neutral esperado', () => {
    expect(createEmptySyncRuntimeStatusSnapshot()).toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isCycleActive: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureMessage: null,
      lastTriggerSource: null,
      lastSyncedCount: 0,
      lastBacklogReadCount: 0,
      lastPrunedOperationsCount: 0,
      isBackgroundTaskRegistered: false,
      lastCycleId: null,
      lastCycleStage: null,
      lastErrorName: null,
      lastNativeErrcodeByte: null,
      lastErrorStage: null,
      consecutiveUnclosedCycles: 0,
      lastCycleStageAt: null,
      lastFailedCheckpointCount: 0,
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

describe('column semantics that the whole runtime-status mapping rests on', () => {
  // These two helpers centralise the operator choice for EVERY optional column, so a single
  // "simplification" here silently rewrites the meaning of the entire table. Both were measured
  // as unpinned: mutating `??` to `||` and `=== undefined` to `== null` left all 844 tests green.
  // These are the tests that make the two mutations die.

  it('withColumnDefault keeps a legitimate 0 or false instead of replacing it', () => {
    // The mutation this kills is `??` -> `||`. `0` and `false` are real persisted values here
    // (counters, flags); a falsy check would swap each of them for the neutral default and the
    // snapshot would report activity that never happened.
    expect(withColumnDefault(0, 5)).toBe(0);
    expect(withColumnDefault(false, true)).toBe(false);
    expect(withColumnDefault('', 'fallback')).toBe('');
  });

  it('withColumnDefault falls back only for an absent value', () => {
    expect(withColumnDefault(null, 5)).toBe(5);
    expect(withColumnDefault(undefined, 5)).toBe(5);
  });

  it('withPatchOverride preserves an explicit null so a column can be cleared', () => {
    // The mutation this kills is `=== undefined` -> `== null` (or `??`). An explicit `null` in a
    // patch means "clear this column" -- that is how "no error this cycle" is representable. A
    // nullish check would read it as "field not mentioned" and keep the stale previous error
    // forever, so a recovered cycle would still report the failure that preceded it.
    expect(withPatchOverride(null, 'previous error')).toBeNull();
  });

  it('withPatchOverride keeps the current value only when the field is absent', () => {
    expect(withPatchOverride(undefined, 'previous error')).toBe('previous error');
    expect(withPatchOverride('new error', 'previous error')).toBe('new error');
  });
});
