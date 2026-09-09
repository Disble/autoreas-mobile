import {
  buildSyncCycleTelemetry,
  capWireSyncCycleTelemetry,
  toWireSyncCycleTelemetry,
} from '../../../../src/features/sync/sync-telemetry.helpers';
import type { SyncRuntimeStatusSnapshot } from '../../../../src/features/sync/sync-runtime-status.types';

/** Builds a neutral runtime snapshot so each test only states the fields it actually exercises. */
function buildSnapshot(
  overrides: Partial<SyncRuntimeStatusSnapshot> = {},
): SyncRuntimeStatusSnapshot {
  return {
    registrationStatus: 'registered',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureMessage: null,
    lastTriggerSource: null,
    lastSyncedCount: 0,
    isCycleActive: false,
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
    lastDiagnosticsDiscardedCount: null,
    lastDiagnosticsFailedRemovalCount: null,
    lastOutboxFailedWriteCount: null,
    lastDeadLetterCount: null,
    lastConflictExhaustedCount: null,
    lastStuckProcessingCount: null,
    lastOldestPendingAgeMs: null,
    lastPendingRowCount: null,
    ...overrides,
  };
}

/** One diagnostic event, used to give the heavy-wire fixture a non-empty event ring to shed. */
const RECENT_EVENT = {
  source: 'websocket' as const,
  event: 'ws_closed' as const,
  cause: null,
  firstAt: 100,
  lastAt: 900,
  count: 4,
};

/** Builds a wire payload heavy enough to force every shed tier when capped hard enough. */
function buildHeavyWire() {
  return toWireSyncCycleTelemetry(
    buildSyncCycleTelemetry({
      cycleId: 'cycle-heavy',
      triggerSource: 'background_task',
      appState: 'background',
      snapshot: buildSnapshot({
        lastAttemptAt: 1710000000000,
        isCycleActive: true,
        lastCycleId: 'cycle-prev',
        lastTriggerSource: 'background_task',
        lastCycleStage: 'apply_write',
        lastErrorName: 'LocalWriteError',
        lastNativeErrcodeByte: 5,
        lastErrorStage: 'begin',
        consecutiveUnclosedCycles: 5,
      }),
      pendingOpsCount: 1,
      cursor: 2259,
      now: 1710000600000,
      recentEvents: [RECENT_EVENT],
    }),
  );
}

describe('degraded tier reporting', () => {
  it('toWireSyncCycleTelemetry emits degraded: null as the second key', () => {
    const wire = toWireSyncCycleTelemetry(
      buildSyncCycleTelemetry({
        cycleId: 'cycle-1',
        triggerSource: 'manual',
        appState: 'foreground',
        snapshot: buildSnapshot(),
        pendingOpsCount: 0,
        cursor: 0,
        now: 1710000000000,
      }),
    );

    expect(wire.degraded).toBeNull();
    // Asserted on the SERIALIZED string, not the object: key order only survives through
    // JSON.stringify, and the bridge reads position, not just presence.
    const serialized = JSON.stringify(wire);
    const secondKeyMatch = /^\{"cycle_id":"[^"]*","([a-z_]+)":/.exec(serialized);

    expect(secondKeyMatch?.[1]).toBe('degraded');
  });

  it('sets degraded: "events" when the event ring is the tier shed', () => {
    const wire = buildHeavyWire();
    // One byte less than the full payload forces exactly the first shedding step.
    const capped = capWireSyncCycleTelemetry(wire, JSON.stringify(wire).length - 1);

    expect(capped?.degraded).toBe('events');
    expect(capped?.recent_events).toEqual([]);
  });

  it('sets degraded: "error_detail" when the previous-cycle error fields are the tier shed', () => {
    const wire = buildHeavyWire();
    // Small enough to force past the event ring (already the only variable-size field) but
    // still large enough to keep outcome/last_stage -- so it lands on the error-detail step.
    const withoutEvents = { ...wire, recent_events: [] };
    const capped = capWireSyncCycleTelemetry(wire, JSON.stringify(withoutEvents).length - 1);

    expect(capped?.degraded).toBe('error_detail');
    expect(capped?.previous_cycle?.error_name).toBeNull();
    expect(capped?.previous_cycle?.outcome).toBe('never_closed');
  });

  it('sets degraded: "previous_cycle" when the whole previous cycle is dropped', () => {
    const wire = buildHeavyWire();
    // Derived from the payload with events AND previous_cycle already gone, so the budget
    // forces exactly this step regardless of how many bytes any single field costs.
    const withoutPreviousCycle = {
      ...wire,
      recent_events: [],
      previous_cycle: null,
      degraded: 'previous_cycle' as const,
    };
    const capped = capWireSyncCycleTelemetry(wire, JSON.stringify(withoutPreviousCycle).length);

    expect(capped?.degraded).toBe('previous_cycle');
    expect(capped?.previous_cycle).toBeNull();
  });

  it('measureWireBytes (via the cap) counts the degraded key -- setting it before measuring never under-reports', () => {
    // A wire whose ONLY way under budget is shedding events must still fit once `degraded`
    // itself is counted. If the tier were set AFTER measuring, this budget (sized off the
    // pre-degraded byte count) would wrongly appear to fit and skip the step.
    const wire = buildHeavyWire();
    const withoutEvents = { ...wire, recent_events: [], degraded: 'events' as const };
    const exactBudget = JSON.stringify(withoutEvents).length;

    const capped = capWireSyncCycleTelemetry(wire, exactBudget);

    expect(capped?.degraded).toBe('events');
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(exactBudget);
  });
});
