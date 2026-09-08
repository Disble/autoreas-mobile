import { BRIDGE_REQUEST_TIMEOUT_MS } from '../../../../src/infrastructure/api/bridge-client/bridge-client.constants';
import { BACKGROUND_SYNC_CYCLE_DEADLINE_MS } from '../../../../src/features/sync/background-sync.constants';
import {
  SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE,
  SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
} from '../../../../src/features/sync/sync-diagnostics-flush.constants';

describe('sync diagnostics flush timing chain', () => {
  it('keeps the flush batch worst case comfortably under the cycle deadline', () => {
    // Row 3 of design.md's timing table: the whole cycle's network worst case (batch of
    // diagnostics POSTs, THEN the reconcile POST) must sit under the cycle deadline, or
    // instrumentation kills the cycle it instruments.
    const worstCaseNetworkMs =
      SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE * SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS +
      BRIDGE_REQUEST_TIMEOUT_MS;

    expect(worstCaseNetworkMs).toBeLessThan(BACKGROUND_SYNC_CYCLE_DEADLINE_MS);
  });

  it('pins the real numbers so a silent change here is caught before it erodes the margin', () => {
    expect(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE).toBe(3);
    expect(SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS).toBe(3_000);
    expect(BRIDGE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(BACKGROUND_SYNC_CYCLE_DEADLINE_MS).toBe(45_000);
  });
});
