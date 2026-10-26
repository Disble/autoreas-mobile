import { act, renderHook } from "@testing-library/react-native";
import { useNetworkState } from "expo-network";
import { useToast } from "heroui-native";
import type { AnimeDayFilter } from "../../../../src/features/animes/anime.types";
import { useAnimeListScreen } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen";
import {
  allActiveAnimes,
  animeByFilter,
  mockCapMinus,
  mockCapMinusHalf,
  mockCapPlus,
  mockCapPlusHalf,
  mockManualSync,
  mockPush,
  mockSetEstado,
  mockToastShow,
  mockUseAnimeList,
  mockUseResponsiveLayout,
} from "./use-anime-list-screen.harness";

// The mutation and state-sheet the screen consumes are mocked here rather than shared with the
// sibling `use-anime-list-screen.test.ts` file: a `jest.mock` registration lives in the registry
// of the file that declares it, so each file states its own. The doubles themselves come from the
// harness, which is where the `mock` prefix they need to survive babel-plugin-jest-hoist lives.

jest.mock("expo-network", () => ({
  useNetworkState: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

jest.mock("heroui-native", () => ({
  useThemeColor: jest.fn(() => ["#ffffff"]),
  useToast: jest.fn(),
}));

jest.mock("../../../../src/contexts/app-theme-context", () => ({
  useAppTheme: jest.fn(() => ({ isDark: false })),
}));

jest.mock("../../../../src/features/settings/use-bridge-config", () => ({
  useBridgeConfig: jest.fn(() => ({
    config: { deviceId: "bridge-1" },
    isConfigured: true,
    isUnpairing: false,
    error: null,
    unpair: jest.fn(),
  })),
}));

jest.mock("../../../../src/features/animes/use-mutate-anime", () => ({
  useMutateAnime: jest.fn(() => ({
    capMinus: mockCapMinus,
    capPlus: mockCapPlus,
    capMinusHalf: mockCapMinusHalf,
    capPlusHalf: mockCapPlusHalf,
    setEstado: mockSetEstado,
  })),
}));

jest.mock("../../../../src/features/animes/use-anime-list", () => ({
  useAnimeList: (...args: unknown[]) => mockUseAnimeList(...args),
}));

jest.mock("../../../../src/features/sync/use-sync-facade", () => ({
  useSyncFacade: jest.fn(() => ({
    connectionStatus: "offline",
    lastSyncAt: null,
    manualSync: mockManualSync,
    pendingOpsCount: 0,
    requestSync: jest.fn(),
  })),
}));

jest.mock("../../../../src/hooks/use-responsive-layout", () => ({
  useResponsiveLayout: (...args: unknown[]) => mockUseResponsiveLayout(...args),
}));

describe("useAnimeListScreen", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-09T10:00:00.000Z"));
    (useToast as jest.Mock).mockReturnValue({
      toast: { show: mockToastShow, hide: jest.fn() },
      isToastVisible: false,
    });
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });
    mockUseAnimeList.mockImplementation((filter: AnimeDayFilter) => ({
      data: animeByFilter[filter] ?? [],
      allActiveAnimes,
    }));
    mockUseResponsiveLayout.mockReturnValue({
      layout: "phone",
      width: 412,
      isCompact: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleWarnSpy.mockRestore();
  });

  it("handleOpenStateSheet setea la solicitud activa", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenStateSheet("thu-1", 0);
    });

    expect(result.current.stateSheetRequest).toEqual({
      animeId: "thu-1",
      currentEstado: 0,
      animeTitle: "Thursday Anime",
    });
  });

  it("handleCloseStateSheet limpia la solicitud activa", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenStateSheet("thu-1", 0);
    });

    act(() => {
      result.current.handleCloseStateSheet();
    });

    expect(result.current.stateSheetRequest).toBeNull();
  });

  it("handleStateSheetSelect invoca setEstado y cierra el sheet", async () => {
    mockSetEstado.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenStateSheet("thu-1", 0);
    });

    await act(async () => {
      await result.current.handleStateSheetSelect(1);
    });

    expect(mockSetEstado).toHaveBeenCalledWith("thu-1", 1);
    expect(result.current.stateSheetRequest).toBeNull();
  });

  it("handleCapPlusHalf delega al mutate con el id del anime", async () => {
    mockCapPlusHalf.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlusHalf("thu-1");
    });

    expect(mockCapPlusHalf).toHaveBeenCalledWith(
      "thu-1",
      expect.objectContaining({
        action: "capPlusHalf",
        correlationId: expect.any(String),
      }),
    );
  });

  it("acepta un segundo tap mientras la primera mutación sigue en vuelo", async () => {
    let resolveCapPlus: (() => void) | null = null;
    mockCapPlus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCapPlus = resolve;
        }),
    );
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    let firstCall: Promise<void>;
    let secondCall: Promise<void>;
    await act(async () => {
      firstCall = result.current.handleCapPlus("thu-1");
      secondCall = result.current.handleCapPlus("thu-1");
    });

    // Both taps reach the mutation: nothing is dropped because another write is still pending.
    expect(mockCapPlus).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveCapPlus?.();
      await Promise.all([firstCall, secondCall]);
    });
  });

  it("permite un nuevo tap cuando la mutación anterior ya terminó", async () => {
    mockCapPlus.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    expect(mockCapPlus).toHaveBeenCalledTimes(2);
  });

  it("mantiene el orden correcto de mutaciones al alternar +, -, +", async () => {
    mockCapPlus.mockResolvedValue(undefined);
    mockCapMinus.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
      await result.current.handleCapMinus("thu-1");
      await result.current.handleCapPlus("thu-1");
    });

    expect(mockCapPlus).toHaveBeenCalledTimes(2);
    expect(mockCapMinus).toHaveBeenCalledTimes(1);
    expect(mockCapPlus.mock.invocationCallOrder[0]).toBeLessThan(
      mockCapMinus.mock.invocationCallOrder[0],
    );
    expect(mockCapMinus.mock.invocationCallOrder[0]).toBeLessThan(
      mockCapPlus.mock.invocationCallOrder[1],
    );
  });

  it("handleCapMinusHalf delega al mutate con el id del anime", async () => {
    mockCapMinusHalf.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapMinusHalf("thu-1");
    });

    expect(mockCapMinusHalf).toHaveBeenCalledWith(
      "thu-1",
      expect.objectContaining({
        action: "capMinusHalf",
        correlationId: expect.any(String),
      }),
    );
  });

  it("shows a toast when the mutation fails instead of swallowing the error", async () => {
    mockCapPlus.mockRejectedValueOnce(new Error("database is locked"));

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "danger",
        label: "No se pudo guardar el capitulo",
        description: "database is locked",
      }),
    );
  });

  // Callers invoke this through `void handleCapPlus(id)`, so anything escaping runMutation
  // becomes an unhandled rejection -- the exact failure this whole path exists to remove.
  // A throwing toast must not reintroduce it.
  it("stays resolved when the toast itself throws", async () => {
    mockCapPlus.mockRejectedValueOnce(new Error("database is locked"));
    mockToastShow.mockImplementationOnce(() => {
      throw new Error("toast renderer exploded");
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await expect(result.current.handleCapPlus("thu-1")).resolves.toBeUndefined();
    });
  });

  it("acepta un tap nuevo después de una mutación fallida", async () => {
    mockCapPlus.mockRejectedValueOnce(new Error("database is locked"));

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    mockCapPlus.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    expect(mockCapPlus).toHaveBeenCalledTimes(2);
  });

  it("does not surface the failed mutation as a rejection to the list caller", async () => {
    mockCapPlus.mockRejectedValueOnce(new Error("database is locked"));

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await expect(result.current.handleCapPlus("thu-1")).resolves.toBeUndefined();
    });
  });
});
