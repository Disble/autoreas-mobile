import { act, renderHook } from "@testing-library/react-native";
import type { AnimeDayFilter } from "../../../../src/features/animes/anime.types";
import { useAnimeListScreen } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

const mockPush = jest.fn();
const mockHandleSyncRequired = jest.fn();
const mockUseAnimeList = jest.fn();
const mockUseWebSocket = jest.fn();
const mockUseResponsiveLayout = jest.fn();
const mockCapPlus = jest.fn();
const mockCapMinus = jest.fn();
const mockCapPlusHalf = jest.fn();
const mockCapMinusHalf = jest.fn();
const mockSetEstado = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

jest.mock("heroui-native", () => ({
  useThemeColor: jest.fn(() => ["#ffffff"]),
}));

jest.mock("../../../../src/contexts/app-theme-context", () => ({
  useAppTheme: jest.fn(() => ({ isDark: false })),
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

jest.mock("../../../../src/features/sync/use-incremental-sync-handler", () => ({
  useIncrementalSyncHandler: jest.fn(() => ({
    handleSyncRequired: mockHandleSyncRequired,
  })),
}));

jest.mock("../../../../src/features/ws/use-websocket", () => ({
  useWebSocket: (...args: unknown[]) => mockUseWebSocket(...args),
}));

jest.mock("../../../../src/hooks/use-responsive-layout", () => ({
  useResponsiveLayout: (...args: unknown[]) => mockUseResponsiveLayout(...args),
}));

function buildAnime(
  id: string,
  nombre: string,
  dias: Anime["dias"] = [],
  overrides: Partial<Anime> = {},
): Anime {
  return {
    _id: id,
    nombre,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias,
    generos: [],
    tipo: null,
    activo: 1,
    primeravez: 0,
    fechaUltCapVisto: null,
    fechaEstreno: null,
    fechaCreacion: null,
    fechaEliminacion: null,
    portada: null,
    pagina: null,
    carpeta: null,
    estudios: null,
    origen: null,
    duracion: null,
    ...overrides,
  };
}

const animeByFilter: Record<AnimeDayFilter, Anime[]> = {
  Lunes: [],
  Martes: [],
  Miércoles: [],
  Jueves: [
    buildAnime("thu-1", "Thursday Anime", [{ dia: "Jueves", orden: 0 }]),
  ],
  Viernes: [
    buildAnime("fri-1", "Friday Anime", [{ dia: "Viernes", orden: 0 }]),
  ],
  Sábado: [],
  Domingo: [],
  "Sin ver": [],
  "Ver hoy": [],
  Visto: [buildAnime("seen-1", "Seen Anime", [{ dia: "Visto", orden: 0 }])],
};

const allActiveAnimes: Anime[] = [
  buildAnime("a", "Anime A", [
    { dia: "Lunes", orden: 0 },
    { dia: "Jueves", orden: 0 },
  ]),
  buildAnime("b", "Anime B", [{ dia: "Jueves", orden: 1 }]),
  buildAnime("c", "Anime C", [{ dia: "Visto", orden: 0 }]),
];

describe("useAnimeListScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-09T10:00:00.000Z"));
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
    mockHandleSyncRequired.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange("Visto");
    });

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(mockHandleSyncRequired).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFilter).toBe("Visto");
    expect(result.current.animes).toEqual(animeByFilter.Visto);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("preserva lista local y filtro si el refresh falla", async () => {
    mockHandleSyncRequired.mockRejectedValueOnce(
      new Error("bridge unavailable"),
    );

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
  });

  it("expone los filter counts calculados a partir de todos los animes activos", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.filterCounts.Lunes).toBe(1);
    expect(result.current.filterCounts.Jueves).toBe(2);
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

  it("handleOpenStateSheet setea la solicitud activa", () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleOpenStateSheet("thu-1", 0);
    });

    expect(result.current.stateSheetRequest).toEqual({
      animeId: "thu-1",
      currentEstado: 0,
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

    expect(mockCapPlusHalf).toHaveBeenCalledWith("thu-1");
  });

  it("ignora taps repetidos mientras la primera mutación sigue en vuelo", async () => {
    let resolveCapPlus: (() => void) | null = null;
    mockCapPlus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCapPlus = resolve;
        }),
    );

    const { result } = renderHook(() => useAnimeListScreen({}));

    let firstCall: Promise<void>;
    await act(async () => {
      firstCall = result.current.handleCapPlus("thu-1");
      void result.current.handleCapPlus("thu-1");
    });

    expect(mockCapPlus).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCapPlus?.();
      await firstCall;
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

    expect(mockCapMinusHalf).toHaveBeenCalledWith("thu-1");
  });
});
