import * as dbClient from '../../../src/infrastructure/db/client';
import {
  runBackgroundSyncCycle,
} from '../../../src/features/sync/background-sync.helpers';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';

jest.mock('../../../src/infrastructure/db/client', () => ({
  openAppDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

describe('background sync helpers', () => {
  const rawDb = { id: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    (dbClient.openAppDatabaseSync as jest.Mock).mockReturnValue(rawDb);
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'success',
      syncedCount: 3,
    });
  });

  it('delegates the background task cycle to the shared headless sync helper', async () => {
    const result = await runBackgroundSyncCycle();

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).toHaveBeenCalledWith({
      rawDb,
      triggerSource: 'background_task',
    });
  });

  it('returns the delegated no-op result unchanged', async () => {
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'no_op',
      syncedCount: 0,
    });

    await expect(runBackgroundSyncCycle()).resolves.toEqual({
      kind: 'no_op',
      syncedCount: 0,
    });
  });

  it('returns the delegated failure result unchanged', async () => {
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'failed',
      syncedCount: 0,
    });

    await expect(runBackgroundSyncCycle()).resolves.toEqual({
      kind: 'failed',
      syncedCount: 0,
    });
  });
});
