import { act, renderHook } from "@testing-library/react-native";
import * as dbClient from "../../../../src/infrastructure/db/client";
import * as nativeRuntime from "../../../../src/infrastructure/db/native-runtime";
import { useDbBootstrap } from "../../../../src/features/setup/use-db-bootstrap";

jest.mock("../../../../src/infrastructure/db/client", () => ({
  DATABASE_NAME: "autoreas.db",
  getBridgeConfigSnapshot: jest.fn(),
  runMigrations: jest.fn(),
}));

jest.mock("../../../../src/infrastructure/db/native-runtime", () => ({
  getSQLiteProvider: jest.fn(),
}));

describe("useDbBootstrap", () => {
  const rawDb = {
    execAsync: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rawDb.execAsync.mockResolvedValue(undefined);
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue("SQLiteProvider");
    (dbClient.runMigrations as jest.Mock).mockResolvedValue(undefined);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);
  });

  it("returns provider metadata for the root layout", () => {
    const { result } = renderHook(() => useDbBootstrap());

    expect(result.current.databaseName).toBe("autoreas.db");
    expect(result.current.sqliteProvider).toBe("SQLiteProvider");
    expect(result.current.sqliteOptions).toEqual({ enableChangeListener: true });
    expect(result.current.bootState).toEqual({ initialized: false, target: null });
  });

  it("boots tabs when a paired device already exists", async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      deviceId: "device-1",
    });

    const { result } = renderHook(() => useDbBootstrap());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(rawDb.execAsync).toHaveBeenCalledWith("PRAGMA journal_mode = WAL;");
    expect(dbClient.runMigrations).toHaveBeenCalledWith(rawDb);
    expect(dbClient.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(result.current.bootState).toEqual({
      initialized: true,
      target: "/(tabs)",
    });
  });

  it("boots setup when no paired device exists", async () => {
    const { result } = renderHook(() => useDbBootstrap());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(result.current.bootState).toEqual({
      initialized: true,
      target: "/setup",
    });
  });
});
