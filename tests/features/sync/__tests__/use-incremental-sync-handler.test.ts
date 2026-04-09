import { act, renderHook } from "@testing-library/react-native";
import * as syncModule from "../../../../src/features/sync/use-initial-sync";
import { useIncrementalSyncHandler } from "../../../../src/features/sync/use-incremental-sync-handler";
import { useOptionalSQLiteContext } from "../../../../src/infrastructure/db/native-runtime";

jest.mock("../../../../src/infrastructure/db/native-runtime", () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock("../../../../src/features/sync/use-initial-sync", () => ({
  incrementalSync: jest.fn(),
}));

describe("useIncrementalSyncHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs incremental sync when sqlite context is available", async () => {
    const rawDb = { name: "raw-db" };

    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (syncModule.incrementalSync as jest.Mock).mockResolvedValue(0);

    const { result } = renderHook(() => useIncrementalSyncHandler());

    await act(async () => {
      await result.current.handleSyncRequired();
    });

    expect(syncModule.incrementalSync).toHaveBeenCalledWith(rawDb, 0);
  });

  it("skips incremental sync when sqlite context is unavailable", async () => {
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useIncrementalSyncHandler());

    await act(async () => {
      await result.current.handleSyncRequired();
    });

    expect(syncModule.incrementalSync).not.toHaveBeenCalled();
  });
});
