import type { SQLiteDatabase } from 'expo-sqlite';
import { runForegroundResyncCycle } from '../../../../src/features/sync/foreground-resync-cycle.helpers';
import * as coverSweep from '../../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import * as fullResyncHelpers from '../../../../src/features/sync/full-resync.helpers';
import * as diagnosticStoreHelpers from '../../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers';

jest.mock('../../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  hydrateCoverUris: jest.fn(),
  runCoverSweep: jest.fn(),
}));

jest.mock('../../../../src/features/sync/full-resync.helpers', () => ({
  resyncFromBridgeSnapshot: jest.fn(),
}));

jest.mock('../../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers', () => ({
  recordDiagnosticEvent: jest.fn(),
}));

/** A dummy `SQLiteDatabase` handle passed through to the mocked collaborators, which never read it. */
const RAW_DB = { id: 'raw-db' } as unknown as SQLiteDatabase;

describe('runForegroundResyncCycle', () => {
  const hydrateCoverUris = coverSweep.hydrateCoverUris as jest.Mock;
  const runCoverSweep = coverSweep.runCoverSweep as jest.Mock;
  const resyncFromBridgeSnapshot = fullResyncHelpers.resyncFromBridgeSnapshot as jest.Mock;
  const recordDiagnosticEvent = diagnosticStoreHelpers.recordDiagnosticEvent as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    hydrateCoverUris.mockResolvedValue(undefined);
    runCoverSweep.mockResolvedValue({ fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false });
    resyncFromBridgeSnapshot.mockResolvedValue({ healed: 0 });
  });

  it('does nothing when rawDb is null', async () => {
    await runForegroundResyncCycle(null);

    expect(hydrateCoverUris).not.toHaveBeenCalled();
    expect(resyncFromBridgeSnapshot).not.toHaveBeenCalled();
    expect(runCoverSweep).not.toHaveBeenCalled();
  });

  it('hydrates before the resync starts', async () => {
    const order: string[] = [];
    hydrateCoverUris.mockImplementation(async () => {
      order.push('hydrate');
    });
    resyncFromBridgeSnapshot.mockImplementation(async () => {
      order.push('resync');
      return { healed: 0 };
    });

    await runForegroundResyncCycle(RAW_DB);

    expect(order).toEqual(['hydrate', 'resync']);
  });

  it('starts the resync without waiting for a hydrate queued behind an in-flight cover sweep', async () => {
    // The hydrate goes through the cover-store mutex, so it can sit behind a sweep that is still
    // downloading images. Chapter data must never wait for that.
    hydrateCoverUris.mockImplementation(() => new Promise<void>(() => undefined));

    void runForegroundResyncCycle(RAW_DB);
    await Promise.resolve();
    await Promise.resolve();

    expect(hydrateCoverUris).toHaveBeenCalledTimes(1);
    expect(resyncFromBridgeSnapshot).toHaveBeenCalledWith(RAW_DB);
  });

  it('runs the sweep after the resync resolves', async () => {
    const order: string[] = [];
    resyncFromBridgeSnapshot.mockImplementation(async () => {
      order.push('resync');
      return { healed: 0 };
    });
    runCoverSweep.mockImplementation(async () => {
      order.push('sweep');
      return { fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false };
    });

    await runForegroundResyncCycle(RAW_DB);

    expect(order).toEqual(['resync', 'sweep']);
    expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB);
  });

  it('runs the sweep after the resync rejects, and reports the exact existing failure payload', async () => {
    const order: string[] = [];
    const failure = new Error('resync boom');
    resyncFromBridgeSnapshot.mockImplementation(async () => {
      order.push('resync');
      throw failure;
    });
    runCoverSweep.mockImplementation(async () => {
      order.push('sweep');
      return { fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false };
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runForegroundResyncCycle(RAW_DB);

    expect(order).toEqual(['resync', 'sweep']);
    expect(warnSpy).toHaveBeenCalledWith('[useForegroundResync] Resync failed', failure);
    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      source: 'foreground_resync',
      event: 'resync_failed',
      cause: expect.anything(),
      at: expect.any(Number),
    });

    warnSpy.mockRestore();
  });

  it('swallows a cover-sweep failure without throwing', async () => {
    runCoverSweep.mockRejectedValue(new Error('sweep boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runForegroundResyncCycle(RAW_DB)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
