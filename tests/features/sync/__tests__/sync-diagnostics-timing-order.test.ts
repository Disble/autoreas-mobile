import { BRIDGE_REQUEST_TIMEOUT_MS } from '../../../../src/infrastructure/api/bridge-client/bridge-client.constants';
import {
  SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE,
  SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
} from '../../../../src/features/sync/sync-diagnostics-flush.constants';

/**
 * The native engine's own attempt budget: `ENGINE_BUDGET_MS` (30 s) in
 * `modules/sync-engine/android/src/main/java/expo/modules/syncengine/SyncEngineDatabases.kt`.
 *
 * This is the budget the chain below is measured against now that the JS background cycle -- and
 * with it `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` -- is deleted. The surviving budget is the native
 * watchdog's, and it lives in Kotlin, so it cannot be imported here; the Kotlin side states the
 * same relation from its own end (`SyncEngineDiagnosticsCourier.kt`: the diagnostics batch costs
 * 9 s of the attempt's 30 s), which is what keeps this mirror honest rather than invented.
 */
const NATIVE_ENGINE_ATTEMPT_BUDGET_MS = 30_000;

describe('sync diagnostics flush timing chain', () => {
  it('keeps the flush batch worst case comfortably under the attempt budget', () => {
    // Row 3 of design.md's timing table: the whole attempt's network worst case (batch of
    // diagnostics POSTs, THEN the reconcile POST) must sit under the attempt budget, or
    // instrumentation kills the cycle it instruments.
    const worstCaseNetworkMs =
      SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE * SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS +
      BRIDGE_REQUEST_TIMEOUT_MS;

    expect(worstCaseNetworkMs).toBeLessThan(NATIVE_ENGINE_ATTEMPT_BUDGET_MS);
  });

  it('pins the real numbers so a silent change here is caught before it erodes the margin', () => {
    expect(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE).toBe(3);
    expect(SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS).toBe(3_000);
    expect(BRIDGE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(NATIVE_ENGINE_ATTEMPT_BUDGET_MS).toBe(30_000);
  });
});
