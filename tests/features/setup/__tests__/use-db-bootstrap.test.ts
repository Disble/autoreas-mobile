import { act, renderHook, waitFor } from "@testing-library/react-native";
import { DATABASE_NAME } from "../../../../src/infrastructure/db/client/client.constants";
import * as dbClientHelpers from "../../../../src/infrastructure/db/client/client.helpers";
import * as nativeRuntime from "../../../../src/infrastructure/db/native-runtime/native-runtime.helpers";
import { useDbBootstrap } from "../../../../src/features/setup/use-db-bootstrap";

interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>["resolve"];
  let reject!: DeferredPromise<T>["reject"];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

jest.mock("../../../../src/infrastructure/db/client/client.constants", () => ({
  DATABASE_NAME: "autoreas.db",
}));

jest.mock("../../../../src/infrastructure/db/client/client.helpers", () => ({
  getBridgeConfigSnapshot: jest.fn(),
  runMigrations: jest.fn(),
}));

jest.mock("../../../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
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
    (dbClientHelpers.runMigrations as jest.Mock).mockResolvedValue(undefined);
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);
  });

  it("returns provider metadata for the root layout", () => {
    const { result } = renderHook(() => useDbBootstrap());

    expect(result.current.databaseName).toBe(DATABASE_NAME);
    expect(result.current.sqliteProvider).toBe("SQLiteProvider");
    expect(result.current.sqliteOptions).toEqual({ enableChangeListener: true });
    expect(result.current.bootState).toEqual({
      failure: null,
      initialized: false,
      target: null,
    });
  });

  it("boots tabs when a paired device already exists", async () => {
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      deviceId: "device-1",
    });

    const { result } = renderHook(() => useDbBootstrap());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(rawDb.execAsync).toHaveBeenCalledWith("PRAGMA journal_mode = WAL;");
    expect(dbClientHelpers.runMigrations).toHaveBeenCalledWith(rawDb);
    expect(dbClientHelpers.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(result.current.bootState).toEqual({
      failure: null,
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
      failure: null,
      initialized: true,
      target: "/setup",
    });
  });

  it("stores a startup failure when migrations reject", async () => {
    const startupError = new Error("SQLITE_ERROR: duplicate column name: device_name");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    (dbClientHelpers.runMigrations as jest.Mock).mockRejectedValue(startupError);

    const { result } = renderHook(() => useDbBootstrap());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(dbClientHelpers.getBridgeConfigSnapshot).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error al preparar la base local durante el inicio."),
      startupError,
    );
    expect(result.current.bootState).toEqual({
      failure: {
        diagnosticMessage: "Error al preparar la base local durante el inicio.",
        recoveryHint:
          "Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.",
      },
      initialized: false,
      target: null,
    });

    consoleErrorSpy.mockRestore();
  });

  it("keeps the latest startup failure when an earlier bootstrap invocation resolves later", async () => {
    const lateSuccess = createDeferredPromise<{ deviceId: string }>();
    const startupError = new Error("SQLITE_BUSY: database locked");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const slowerRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    const failingRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (dbClientHelpers.runMigrations as jest.Mock).mockImplementation(async (database) => {
      if (database === failingRawDb) {
        throw startupError;
      }

      return undefined;
    });
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockImplementation(async (database) => {
      if (database === slowerRawDb) {
        return lateSuccess.promise;
      }

      return null;
    });

    const { result } = renderHook(() => useDbBootstrap());
    let firstInitPromise!: Promise<void>;

    await act(async () => {
      firstInitPromise = result.current.handleDatabaseInit(slowerRawDb as never);
      const secondInitPromise = result.current.handleDatabaseInit(failingRawDb as never);

      await secondInitPromise;
    });

    await waitFor(() => {
      expect(result.current.bootState).toEqual({
        failure: {
          diagnosticMessage: "Error al preparar la base local durante el inicio.",
          recoveryHint:
            "Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.",
        },
        initialized: false,
        target: null,
      });
    });

    await act(async () => {
      lateSuccess.resolve({ deviceId: "device-1" });
      await firstInitPromise;
    });

    expect(result.current.bootState).toEqual({
      failure: {
        diagnosticMessage: "Error al preparar la base local durante el inicio.",
        recoveryHint:
          "Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.",
      },
      initialized: false,
      target: null,
    });

    consoleErrorSpy.mockRestore();
  });

  it("stores a startup failure when the bridge config snapshot rejects", async () => {
    const startupError = new Error("Missing bridge_config row");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockRejectedValue(startupError);

    const { result } = renderHook(() => useDbBootstrap());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error al leer la configuración local durante el inicio."),
      startupError,
    );
    expect(result.current.bootState).toEqual({
      failure: {
        diagnosticMessage: "Error al leer la configuración local durante el inicio.",
        recoveryHint:
          "Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.",
      },
      initialized: false,
      target: null,
    });

    consoleErrorSpy.mockRestore();
  });
});
