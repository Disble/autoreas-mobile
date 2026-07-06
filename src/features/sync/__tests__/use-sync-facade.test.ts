import { act, renderHook } from '@testing-library/react-native';
import { useOptionalLiveQuery, useOptionalSQLiteContext } from '../../../infrastructure/db/native-runtime';
import { useActiveSeasonStore } from '../../../infrastructure/store/active-season-store';
import { useBridgeConfig } from '../../settings/use-bridge-config';
import { drainSeasonRatingQueue } from '../season-rating-queue.helpers';
import { syncPendingOperations } from '../reconcile.helpers';
import { buildPendingOperationsQuery } from '../sync-facade.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from '../sync-runtime-status.helpers';
import { useSyncFacade } from '../use-sync-facade';
import { fetchActiveSeasonFromBridge } from '../use-season-sync.helpers';

jest.mock('../../../infrastructure/db/native-runtime', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../sync-facade.helpers', () => ({
  buildPendingOperationsQuery: jest.fn(),
  transitionSyncState: jest.requireActual('../sync-facade.helpers').transitionSyncState,
}));

jest.mock('../season-rating-queue.helpers', () => ({
  drainSeasonRatingQueue: jest.fn(),
}));

jest.mock('../use-season-sync.helpers', () => ({
  fetchActiveSeasonFromBridge: jest.fn(),
}));

jest.mock('../sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

describe('useSyncFacade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useActiveSeasonStore.setState({ activeSeasonSnapshot: null });
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({ data: [] });
    (useBridgeConfig as jest.Mock).mockReturnValue({ isConfigured: true });
    (buildPendingOperationsQuery as jest.Mock).mockReturnValue({});
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
  });

  it('drains season ratings and refreshes the active-season projection after a sync', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 3,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 1,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
    });
    (fetchActiveSeasonFromBridge as jest.Mock).mockResolvedValue({
      seasonId: 'season-2026-q3',
      candidates: [],
      candidatesByAnimeId: {},
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.requestSync('manual')).resolves.toBe(3);
    });

    expect(syncPendingOperations).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(drainSeasonRatingQueue).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(fetchActiveSeasonFromBridge).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(useActiveSeasonStore.getState().activeSeasonSnapshot?.seasonId).toBe(
      'season-2026-q3',
    );
  });

  it('skips the active-season refresh when queue drain did not change bridge truth', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: false,
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await result.current.requestSync('bootstrap');
    });

    expect(fetchActiveSeasonFromBridge).not.toHaveBeenCalled();
    expect(useActiveSeasonStore.getState().activeSeasonSnapshot).toBeNull();
  });
});
