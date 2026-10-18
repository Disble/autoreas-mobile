import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import { ActiveSeasonSyncError } from '../../../src/features/sync/season-sync.errors';
import { fetchActiveSeasonFromBridge } from '../../../src/features/sync/season-sync.helpers';
import { runCoordinatedForegroundSyncCycle } from '../../../src/features/sync/sync-facade.helpers';
import {
  getSyncConnectionSnapshot,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from '../../../src/features/sync/sync-runtime-status.helpers';

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/season-sync.helpers', () => ({
  ...jest.requireActual('../../../src/features/sync/season-sync.helpers'),
  fetchActiveSeasonFromBridge: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

// Both cases below use `source: 'manual'`, which now also starts a (non-awaited) cover sweep --
// see `tests/features/sync/__tests__/sync-facade.helpers.test.ts` for that behavior's own
// coverage. Mocked here purely so this file's real-DB-shaped `rawDb` fixture never reaches the
// real `DEFAULT_COVER_SWEEP_DEPENDENCIES` in the background.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue({
    fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
  }),
}));

describe('foreground sync failure precedence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
  });

  it.each([
    [
      'an unreachable refresh triggered by an unresolved rating',
      new BridgeUnreachableError('http://127.0.0.1:9876/api/seasons/active', 'offline'),
      0,
    ],
    [
      'an invalid reachable active-season response after a delivered rating',
      new ActiveSeasonSyncError('Active season fetch failed: 500', 500, '{"error":"internal"}'),
      1,
    ],
  ])('never fails the cycle over %s: the refresh is best effort and keeps the cached season', async (_case, refreshFailure, deliveredCount) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setActiveSeasonSnapshot = jest.fn();
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: deliveredCount,
      hasMorePending: false,
      shouldRefreshActiveSeason: true,
    });
    (fetchActiveSeasonFromBridge as jest.Mock).mockRejectedValue(refreshFailure);

    await expect(
      runCoordinatedForegroundSyncCycle({
        rawDb: { id: 'raw-db' } as never,
        source: 'manual',
        setActiveSeasonSnapshot,
      }),
    ).resolves.toBe(deliveredCount);

    expect(fetchActiveSeasonFromBridge).toHaveBeenCalledTimes(1);
    expect(setActiveSeasonSnapshot).not.toHaveBeenCalled();
    expect(recordSyncAttemptFailed).not.toHaveBeenCalled();
    expect(recordSyncAttemptSucceeded).toHaveBeenCalledTimes(1);
    expect(getSyncConnectionSnapshot()).toMatchObject({ kind: 'online' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[refreshActiveSeasonSnapshot]'), refreshFailure);
    warn.mockRestore();
  });
});
