import { act, renderHook } from "@testing-library/react-native";
import { useIncrementalSyncHandler } from "../../../../src/features/sync/use-incremental-sync-handler";
import { useSyncFacade } from '../../../../src/features/sync/use-sync-facade';

jest.mock('../../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

describe("useIncrementalSyncHandler", () => {
  const mockManualSync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useSyncFacade as jest.Mock).mockReturnValue({
      manualSync: mockManualSync,
      connectionStatus: 'idle',
      lastSyncAt: null,
      pendingOpsCount: 0,
      syncError: null,
    });
  });

  it("delegates sync requests to the shared sync facade", async () => {
    mockManualSync.mockResolvedValue(0);

    const { result } = renderHook(() => useIncrementalSyncHandler());

    await act(async () => {
      await result.current.handleSyncRequired();
    });

    expect(mockManualSync).toHaveBeenCalledTimes(1);
  });
});
