import { act, renderHook } from '@testing-library/react-native';
import { useAnimeCard } from '../../../src/features/animes/ui/AnimeCard/use-anime-card';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';

describe('useAnimeCard', () => {
  const baseAnime: Anime = {
    _id: 'anime-1',
    nombre: 'One Piece',
    estado: 0,
    nrocapvisto: 3,
    totalcap: 12,
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

  it('bloquea ambos botones mientras hay mutación en curso', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: true,
      }),
    );

    expect(result.current.disableDecrease).toBe(true);
    expect(result.current.disableIncrease).toBe(true);
  });

  it('mantiene reglas normales cuando no hay mutación en curso', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.disableDecrease).toBe(false);
    expect(result.current.disableIncrease).toBe(false);
  });

  it('bloquea ambos botones cuando el anime está finalizado', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: {
          ...baseAnime,
          estado: 1,
          nrocapvisto: 12,
          totalcap: 12,
        },
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.disableDecrease).toBe(true);
    expect(result.current.disableIncrease).toBe(true);
  });

  it('bloquea ambos botones cuando el anime está en pausa', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: {
          ...baseAnime,
          estado: 3,
        },
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.disableDecrease).toBe(true);
    expect(result.current.disableIncrease).toBe(true);
  });

  it('bloquea ambos botones cuando el anime está en no me gustó', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: {
          ...baseAnime,
          estado: 2,
        },
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.disableDecrease).toBe(true);
    expect(result.current.disableIncrease).toBe(true);
  });

  it('expone el chip de estado desde el helper', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: { ...baseAnime, estado: 3 },
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.stateChip).toMatchObject({
      label: 'En pausa',
      tone: 'warning',
    });
  });

  it('toggleRestantesShown alterna entre contador y restantes', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.restantesShown).toBe(false);

    act(() => {
      result.current.toggleRestantesShown();
    });
    expect(result.current.restantesShown).toBe(true);

    act(() => {
      result.current.toggleRestantesShown();
    });
    expect(result.current.restantesShown).toBe(false);
  });

  it('expone etiqueta de restantes cuando hay totalcap', () => {
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: { ...baseAnime, nrocapvisto: 3, totalcap: 12 },
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        isMutating: false,
      }),
    );

    expect(result.current.restantesLabel).toBe('9 restantes');
  });

  it('handleStateBadgePress abre el sheet vía onOpenStateSheet', () => {
    const onOpenStateSheet = jest.fn();
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        onOpenStateSheet,
        isMutating: false,
      }),
    );

    act(() => {
      result.current.handleStateBadgePress();
    });

    expect(onOpenStateSheet).toHaveBeenCalledWith(baseAnime._id, baseAnime.estado);
  });

  it('handleCapPlusLongPress invoca onCapPlusHalf', () => {
    const onCapPlusHalf = jest.fn();
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        onCapPlusHalf,
        isMutating: false,
      }),
    );

    act(() => {
      result.current.handleCapPlusLongPress();
    });

    expect(onCapPlusHalf).toHaveBeenCalledTimes(1);
  });

  it('handleCapMinusLongPress invoca onCapMinusHalf', () => {
    const onCapMinusHalf = jest.fn();
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus: jest.fn(),
        onCapPlus: jest.fn(),
        onCapMinusHalf,
        isMutating: false,
      }),
    );

    act(() => {
      result.current.handleCapMinusLongPress();
    });

    expect(onCapMinusHalf).toHaveBeenCalledTimes(1);
  });
});
