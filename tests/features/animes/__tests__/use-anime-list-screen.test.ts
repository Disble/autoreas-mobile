import { act, renderHook } from '@testing-library/react-native';
import type { Anime } from '../../../../src/infrastructure/validation/anime-schema';
import type { AnimeDayFilter } from '../../../../src/features/animes/anime.types';
import { useAnimeListScreen } from '../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen';

const mockPush = jest.fn();
const mockHandleSyncRequired = jest.fn();
const mockUseAnimeList = jest.fn();
const mockUseWebSocket = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

jest.mock('heroui-native', () => ({
  useThemeColor: jest.fn(() => ['#ffffff']),
}));

jest.mock('../../../../src/contexts/app-theme-context', () => ({
  useAppTheme: jest.fn(() => ({ isDark: false })),
}));

jest.mock('../../../../src/features/animes/use-mutate-anime', () => ({
  useMutateAnime: jest.fn(() => ({
    capMinus: jest.fn(),
    capPlus: jest.fn(),
  })),
}));

jest.mock('../../../../src/features/animes/use-anime-list', () => ({
  useAnimeList: (...args: unknown[]) => mockUseAnimeList(...args),
}));

jest.mock('../../../../src/features/sync/use-incremental-sync-handler', () => ({
  useIncrementalSyncHandler: jest.fn(() => ({
    handleSyncRequired: mockHandleSyncRequired,
  })),
}));

jest.mock('../../../../src/features/ws/use-websocket', () => ({
  useWebSocket: (...args: unknown[]) => mockUseWebSocket(...args),
}));

function buildAnime(id: string, nombre: string): Anime {
  return {
    _id: id,
    nombre,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: [],
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
  };
}

const animeByFilter: Record<AnimeDayFilter, Anime[]> = {
  Lunes: [],
  Martes: [],
  Miércoles: [],
  Jueves: [buildAnime('thu-1', 'Thursday Anime')],
  Viernes: [buildAnime('fri-1', 'Friday Anime')],
  Sábado: [],
  Domingo: [],
  'Sin ver': [],
  'Ver hoy': [],
  Visto: [buildAnime('seen-1', 'Seen Anime')],
};

describe('useAnimeListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-09T10:00:00.000Z'));
    mockUseAnimeList.mockImplementation((filter: AnimeDayFilter) => ({
      data: animeByFilter[filter] ?? [],
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa el día actual como filtro inicial', () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    expect(result.current.selectedFilter).toBe('Jueves');
    expect(result.current.animes).toEqual(animeByFilter.Jueves);
    expect(mockUseAnimeList).toHaveBeenLastCalledWith('Jueves');
  });

  it('actualiza el filtro cuando cambia la selección', () => {
    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange({
        label: 'Viernes',
        value: 'Viernes',
      });
    });

    expect(result.current.selectedFilter).toBe('Viernes');
    expect(result.current.animes).toEqual(animeByFilter.Viernes);
    expect(mockUseAnimeList).toHaveBeenLastCalledWith('Viernes');
  });

  it('mantiene el filtro seleccionado después de un refresh exitoso', async () => {
    mockHandleSyncRequired.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange({
        label: 'Visto',
        value: 'Visto',
      });
    });

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(mockHandleSyncRequired).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFilter).toBe('Visto');
    expect(result.current.animes).toEqual(animeByFilter.Visto);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('preserva lista local y filtro si el refresh falla', async () => {
    mockHandleSyncRequired.mockRejectedValueOnce(new Error('bridge unavailable'));

    const { result } = renderHook(() => useAnimeListScreen({}));

    act(() => {
      result.current.handleSelectedFilterChange({
        label: 'Visto',
        value: 'Visto',
      });
    });

    await act(async () => {
      await result.current.handleRefresh();
    });

    expect(result.current.selectedFilter).toBe('Visto');
    expect(result.current.animes).toEqual(animeByFilter.Visto);
    expect(result.current.isRefreshing).toBe(false);
  });
});
