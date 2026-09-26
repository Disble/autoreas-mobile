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
// sibling `*.mutation-handlers.test.ts` file: a `jest.mock` registration lives in the registry of
// the file that declares it, so each file states its own. The doubles themselves come from the
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
    syncError: null,
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
      isCompact: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleWarnSpy.mockRestore();
  });

  it("usa el día actual como filtro inicial", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.selectedFilter).toBe("Jueves");
    expect(result.current.animes).toEqual(animeByFilter.Jueves);
    expect(mockUseAnimeList).toHaveBeenLastCalledWith("Jueves");
  });

  it("actualiza el filtro cuando cambia la selección", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange("Viernes");
    });

    expect(result.current.selectedFilter).toBe("Viernes");
    expect(result.current.animes).toEqual(animeByFilter.Viernes);
    expect(mockUseAnimeList).toHaveBeenLastCalledWith("Viernes");
  });

  it("mantiene el filtro seleccionado después de un refresh exitoso", async () => {
    mockManualSync.mockResolvedValueOnce(0);

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange("Visto");
    });

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(mockManualSync).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFilter).toBe("Visto");
    expect(result.current.animes).toEqual(animeByFilter.Visto);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("preserva lista local y filtro si el refresh falla", async () => {
    mockManualSync.mockRejectedValueOnce(new Error("bridge unavailable"));

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange("Visto");
    });

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(result.current.selectedFilter).toBe("Visto");
    expect(result.current.animes).toEqual(animeByFilter.Visto);
    expect(result.current.isRefreshing).toBe(false);
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Tus cambios siguen guardados en este dispositivo.',
        label: 'No se pudo sincronizar con el bridge.',
        variant: "warning",
      }),
    );
  });

  it("no muestra toast ni intenta sync cuando el teléfono está offline", async () => {
    (useNetworkState as jest.Mock).mockReturnValueOnce({
      isConnected: true,
      isInternetReachable: false,
    });
    mockManualSync.mockRejectedValueOnce(new Error("bridge unavailable"));

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(mockManualSync).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("expone el refresh manual como deshabilitado cuando el teléfono está offline", () => {
    (useNetworkState as jest.Mock).mockReturnValueOnce({
      isConnected: true,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.isManualSyncEnabled).toBe(false);
  });

  it("no intenta manual sync cuando el estado actual dice que no puede funcionar ahora", async () => {
    (useNetworkState as jest.Mock).mockReturnValueOnce({
      isConnected: true,
      isInternetReachable: false,
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(mockManualSync).not.toHaveBeenCalled();
    expect(result.current.isRefreshing).toBe(false);
  });

  it("rehabilita el refresh manual cuando la disponibilidad vuelve a ser válida", () => {
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: false,
    });

    // `tick` exists only to give `rerender` a changing prop; the hook itself takes none.
    const { result, rerender } = renderHook(
      () => useAnimeListScreen({}),
      {
        initialProps: { tick: 0 },
      },
    );

    expect(result.current.isManualSyncEnabled).toBe(false);

    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });

    rerender({ tick: 1 });

    expect(result.current.isManualSyncEnabled).toBe(true);
  });

  it("expone un estado de sync derivado para el banner inline", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.syncStatus.chipLabel).toBe("Catálogo local");
    expect(result.current.syncStatus.title).toBe("Catálogo local listo");
    expect(result.current.syncStatus.actionLabel).toBeNull();
  });

  it("marca el teléfono offline como una causa distinta al bridge caído", () => {
    (useNetworkState as jest.Mock).mockReturnValueOnce({
      isConnected: true,
      isInternetReachable: false,
    });

    const syncFacadeModule = jest.requireMock(
      "../../../../src/features/sync/use-sync-facade",
    ) as {
      useSyncFacade: jest.Mock;
    };
    syncFacadeModule.useSyncFacade.mockReturnValueOnce({
      connectionStatus: "error",
      lastSyncAt: new Date("2026-04-08T10:00:00.000Z").getTime(),
      manualSync: mockManualSync,
      pendingOpsCount: 2,
      requestSync: jest.fn(),
      syncError: "bridge unavailable",
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.syncStatus.chipLabel).toBe("Sin conexión");
    expect(result.current.syncStatus.actionLabel).toBeNull();
  });

  it("propone emparejar un bridge cuando hay backlog pero no existe bridge configurado", () => {
    const bridgeConfigModule = jest.requireMock(
      "../../../../src/features/settings/use-bridge-config",
    ) as {
      useBridgeConfig: jest.Mock;
    };
    bridgeConfigModule.useBridgeConfig.mockReturnValueOnce({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    const syncFacadeModule = jest.requireMock(
      "../../../../src/features/sync/use-sync-facade",
    ) as {
      useSyncFacade: jest.Mock;
    };
    syncFacadeModule.useSyncFacade.mockReturnValueOnce({
      connectionStatus: "offline",
      lastSyncAt: null,
      manualSync: mockManualSync,
      pendingOpsCount: 2,
      requestSync: jest.fn(),
      syncError: null,
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.syncStatus.chipLabel).toBe("Sync pendiente");
    expect(result.current.syncStatus.actionLabel).toBe("Emparejar bridge");
  });

  it("expone el refresh manual como deshabilitado mientras sync ya está en progreso", () => {
    const syncFacadeModule = jest.requireMock(
      "../../../../src/features/sync/use-sync-facade",
    ) as {
      useSyncFacade: jest.Mock;
    };
    syncFacadeModule.useSyncFacade.mockReturnValueOnce({
      connectionStatus: "syncing",
      lastSyncAt: null,
      manualSync: mockManualSync,
      pendingOpsCount: 0,
      requestSync: jest.fn(),
      syncError: null,
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.isManualSyncEnabled).toBe(false);
  });

  it("expone los filter counts calculados a partir de todos los animes activos", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.filterCounts.Lunes).toBe(0);
    expect(result.current.filterCounts.Jueves).toBe(0);
    expect(result.current.filterCounts.Visto).toBe(1);
  });

  it("expone el header contextual basado en el filtro y los counts", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.contextualHeader.title).toBe("Jueves");
    expect(result.current.contextualHeader.isToday).toBe(true);
    expect(result.current.contextualHeader.subtitle).toMatch(/anime/);
  });

  it("expone el día de hoy como filtro de referencia", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.today).toBe("Jueves");
  });

  it("expone el layoutMode desde useResponsiveLayout", () => {
    mockUseResponsiveLayout.mockReturnValueOnce({
      layout: "tablet-landscape",
      isCompact: false,
    });

    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.layoutMode).toBe("tablet-landscape");
  });
});
