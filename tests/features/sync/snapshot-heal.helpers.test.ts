import type { SQLiteDatabase } from 'expo-sqlite';
import * as fullResyncHelpers from '../../../src/features/sync/full-resync.helpers';
import * as diagnosticStoreHelpers from '../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers';
import { SNAPSHOT_HEAL_STALE_AFTER_MS } from '../../../src/features/sync/snapshot-heal.constants';
import { healSnapshotOnDemand } from '../../../src/features/sync/snapshot-heal.helpers';

jest.mock('../../../src/features/sync/full-resync.helpers', () => ({
  resyncFromBridgeSnapshot: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers', () => ({
  recordDiagnosticEvent: jest.fn(),
}));

/** A fresh database handle per call: the last-heal timestamp is kept per database. */
function freshDatabase(): SQLiteDatabase {
  return { id: Symbol('raw-db') } as unknown as SQLiteDatabase;
}

/** A clock the test moves by hand. */
function manualClock(start: number): { readonly now: () => number; readonly advance: (ms: number) => void } {
  let current = start;

  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('snapshot heal on demand (ADR 009 R-7)', () => {
  const resyncFromBridgeSnapshot = fullResyncHelpers.resyncFromBridgeSnapshot as jest.Mock;
  const recordDiagnosticEvent = diagnosticStoreHelpers.recordDiagnosticEvent as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resyncFromBridgeSnapshot.mockResolvedValue({ healed: 0 });
  });

  it('always heals on an `always` demand, however recent the last heal was', async () => {
    const database = freshDatabase();
    const clock = manualClock(1_000_000);

    await healSnapshotOnDemand(database, 'always', clock.now);
    await healSnapshotOnDemand(database, 'always', clock.now);

    expect(resyncFromBridgeSnapshot).toHaveBeenCalledTimes(2);
    expect(resyncFromBridgeSnapshot).toHaveBeenCalledWith(database);
  });

  it('never heals on a `never` demand', async () => {
    await healSnapshotOnDemand(freshDatabase(), 'never', () => 0);

    expect(resyncFromBridgeSnapshot).not.toHaveBeenCalled();
  });

  it('heals an `if_stale` demand when no heal has succeeded yet', async () => {
    await healSnapshotOnDemand(freshDatabase(), 'if_stale', () => 1_000_000);

    expect(resyncFromBridgeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('skips an `if_stale` demand until the last successful heal is more than 5 min old', async () => {
    const database = freshDatabase();
    const clock = manualClock(1_000_000);
    await healSnapshotOnDemand(database, 'always', clock.now);
    resyncFromBridgeSnapshot.mockClear();

    clock.advance(SNAPSHOT_HEAL_STALE_AFTER_MS);
    await healSnapshotOnDemand(database, 'if_stale', clock.now);
    expect(resyncFromBridgeSnapshot).not.toHaveBeenCalled();

    clock.advance(1);
    await healSnapshotOnDemand(database, 'if_stale', clock.now);
    expect(resyncFromBridgeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not reset the interval on a failed heal', async () => {
    const database = freshDatabase();
    const clock = manualClock(1_000_000);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await healSnapshotOnDemand(database, 'always', clock.now);

    clock.advance(SNAPSHOT_HEAL_STALE_AFTER_MS + 1);
    resyncFromBridgeSnapshot.mockRejectedValueOnce(new Error('bridge unreachable'));
    await healSnapshotOnDemand(database, 'always', clock.now);
    resyncFromBridgeSnapshot.mockClear();

    // The failed heal ran a moment ago, yet the last SUCCESSFUL one is still stale.
    await healSnapshotOnDemand(database, 'if_stale', clock.now);
    expect(resyncFromBridgeSnapshot).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('keeps a failed heal best effort: it resolves and reports the existing failure payload', async () => {
    const failure = new Error('resync boom');
    resyncFromBridgeSnapshot.mockRejectedValue(failure);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(healSnapshotOnDemand(freshDatabase(), 'always', () => 5)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith('[useForegroundResync] Resync failed', failure);
    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      source: 'foreground_resync',
      event: 'resync_failed',
      cause: expect.anything(),
      at: 5,
    });

    warnSpy.mockRestore();
  });
});
