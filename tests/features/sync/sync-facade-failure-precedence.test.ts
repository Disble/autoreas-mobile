import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import { drainSeasonRatingQueue } from '../../../src/features/sync/season-rating-queue.helpers';
import {
  ActiveSeasonSyncError,
  fetchActiveSeasonFromBridge,
} from '../../../src/features/sync/season-sync.helpers';
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

jest.mock('../../../src/features/sync/season-rating-queue.helpers', () => ({
  drainSeasonRatingQueue: jest.fn(),
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

describe('foreground sync failure precedence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
  });

  it('keeps a terminal rating rejection authoritative when refresh would be unreachable', async () => {
    const ratingFailure = new Error('Season rating delivery incomplete: conflict');
    const refreshFailure = new BridgeUnreachableError(
      'http://127.0.0.1:8080/api/seasons/active',
      'offline',
    );

    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
      failure: ratingFailure,
    });
    (fetchActiveSeasonFromBridge as jest.Mock).mockRejectedValue(refreshFailure);

    await expect(
      runCoordinatedForegroundSyncCycle({
        rawDb: { id: 'raw-db' } as never,
        source: 'manual',
        setActiveSeasonSnapshot: jest.fn(),
      }),
    ).rejects.toBe(ratingFailure);

    expect(fetchActiveSeasonFromBridge).not.toHaveBeenCalled();
    expect(recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(recordSyncAttemptFailed).toHaveBeenCalledWith(
      { id: 'raw-db' },
      'manual',
      expect.any(Number),
      ratingFailure.message,
    );
    expect(getSyncConnectionSnapshot()).toMatchObject({
      kind: 'sync_error',
      message: ratingFailure.message,
    });
  });

  it('publishes sync_error when a reachable active-season response is invalid', async () => {
    const activeSeasonFailure = new ActiveSeasonSyncError(
      'Active season fetch failed: 500',
      500,
      '{"error":"internal"}',
    );

    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 1,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
      failure: null,
    });
    (fetchActiveSeasonFromBridge as jest.Mock).mockRejectedValue(activeSeasonFailure);

    await expect(
      runCoordinatedForegroundSyncCycle({
        rawDb: { id: 'raw-db' } as never,
        source: 'manual',
        setActiveSeasonSnapshot: jest.fn(),
      }),
    ).rejects.toBe(activeSeasonFailure);

    expect(recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(getSyncConnectionSnapshot()).toMatchObject({
      kind: 'sync_error',
      message: activeSeasonFailure.message,
    });
  });
});
