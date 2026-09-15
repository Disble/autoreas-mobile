import { act, renderHook } from '@testing-library/react-native';
import { useAnimeCard } from '../../../src/features/animes/ui/AnimeCard/use-anime-card';
import type { AnimeCardProps } from '../../../src/features/animes/ui/AnimeCard/anime-card.types';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';

/** Chapter tap callbacks that vary across rerenders in the "latest callback" tests. */
type MutableAnimeCardCallbackProps = Pick<AnimeCardProps, 'onCapPlus' | 'onCapMinus'>;

/** Chapter half-cap long-press callbacks that vary across rerenders in the "latest callback" tests. */
type MutableAnimeCardHalfCallbackProps = Pick<AnimeCardProps, 'onCapPlusHalf' | 'onCapMinusHalf'>;

/** State-sheet callback and anime state that vary across rerenders in the "latest callback" test. */
type MutableAnimeCardStateSheetProps = Pick<AnimeCardProps, 'onOpenStateSheet'> & {
  readonly estado: number;
};

/** Season-rating callback and anime id that vary across rerenders in the "latest callback" test. */
type MutableAnimeCardSeasonRatingProps = Pick<AnimeCardProps, 'onOpenSeasonRatingSheet'> & {
  readonly animeId: string;
};

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
      isDefault: false,
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

  it('mantiene handlers de tap alineados con la acción correcta al alternar + y -', () => {
    const onCapPlus = jest.fn();
    const onCapMinus = jest.fn();
    const { result } = renderHook(() =>
      useAnimeCard({
        anime: baseAnime,
        onCapMinus,
        onCapPlus,
        isMutating: false,
      }),
    );

    act(() => {
      result.current.handleCapPlusPress();
      result.current.handleCapMinusPress();
      result.current.handleCapPlusPress();
    });

    expect(onCapPlus).toHaveBeenCalledTimes(2);
    expect(onCapMinus).toHaveBeenCalledTimes(1);
    expect(onCapPlus.mock.invocationCallOrder[0]).toBeLessThan(
      onCapMinus.mock.invocationCallOrder[0],
    );
    expect(onCapMinus.mock.invocationCallOrder[0]).toBeLessThan(
      onCapPlus.mock.invocationCallOrder[1],
    );
  });

  it('usa siempre los callbacks más recientes después de un rerender', () => {
    const firstOnCapPlus = jest.fn();
    const firstOnCapMinus = jest.fn();
    const secondOnCapPlus = jest.fn();
    const secondOnCapMinus = jest.fn();
    const { result, rerender } = renderHook(
      ({ onCapPlus, onCapMinus }: MutableAnimeCardCallbackProps) =>
        useAnimeCard({
          anime: baseAnime,
          onCapMinus,
          onCapPlus,
          isMutating: false,
        }),
      {
        initialProps: {
          onCapPlus: firstOnCapPlus,
          onCapMinus: firstOnCapMinus,
        },
      },
    );

    rerender({
      onCapPlus: secondOnCapPlus,
      onCapMinus: secondOnCapMinus,
    });

    act(() => {
      result.current.handleCapPlusPress();
      result.current.handleCapMinusPress();
    });

    expect(firstOnCapPlus).not.toHaveBeenCalled();
    expect(firstOnCapMinus).not.toHaveBeenCalled();
    expect(secondOnCapPlus).toHaveBeenCalledTimes(1);
    expect(secondOnCapMinus).toHaveBeenCalledTimes(1);
  });

  it('usa siempre los callbacks de half-cap más recientes después de un rerender', () => {
    const firstOnCapPlusHalf = jest.fn();
    const firstOnCapMinusHalf = jest.fn();
    const secondOnCapPlusHalf = jest.fn();
    const secondOnCapMinusHalf = jest.fn();
    const { result, rerender } = renderHook(
      ({ onCapPlusHalf, onCapMinusHalf }: MutableAnimeCardHalfCallbackProps) =>
        useAnimeCard({
          anime: baseAnime,
          onCapMinus: jest.fn(),
          onCapPlus: jest.fn(),
          onCapPlusHalf,
          onCapMinusHalf,
          isMutating: false,
        }),
      {
        initialProps: {
          onCapPlusHalf: firstOnCapPlusHalf,
          onCapMinusHalf: firstOnCapMinusHalf,
        },
      },
    );

    rerender({
      onCapPlusHalf: secondOnCapPlusHalf,
      onCapMinusHalf: secondOnCapMinusHalf,
    });

    act(() => {
      result.current.handleCapPlusLongPress();
      result.current.handleCapMinusLongPress();
    });

    expect(firstOnCapPlusHalf).not.toHaveBeenCalled();
    expect(firstOnCapMinusHalf).not.toHaveBeenCalled();
    expect(secondOnCapPlusHalf).toHaveBeenCalledTimes(1);
    expect(secondOnCapMinusHalf).toHaveBeenCalledTimes(1);
  });

  it('usa siempre el callback y el estado más recientes de onOpenStateSheet después de un rerender', () => {
    const firstOnOpenStateSheet = jest.fn();
    const secondOnOpenStateSheet = jest.fn();
    const { result, rerender } = renderHook(
      ({ onOpenStateSheet, estado }: MutableAnimeCardStateSheetProps) =>
        useAnimeCard({
          anime: { ...baseAnime, estado },
          onCapMinus: jest.fn(),
          onCapPlus: jest.fn(),
          onOpenStateSheet,
          isMutating: false,
        }),
      {
        initialProps: {
          onOpenStateSheet: firstOnOpenStateSheet,
          estado: 0,
        },
      },
    );

    rerender({
      onOpenStateSheet: secondOnOpenStateSheet,
      estado: 3,
    });

    act(() => {
      result.current.handleStateBadgePress();
    });

    expect(firstOnOpenStateSheet).not.toHaveBeenCalled();
    expect(secondOnOpenStateSheet).toHaveBeenCalledTimes(1);
    expect(secondOnOpenStateSheet).toHaveBeenCalledWith(baseAnime._id, 3);
  });

  it('usa siempre el callback y el id más recientes de onOpenSeasonRatingSheet después de un rerender', () => {
    const firstOnOpenSeasonRatingSheet = jest.fn();
    const secondOnOpenSeasonRatingSheet = jest.fn();
    const { result, rerender } = renderHook(
      ({ onOpenSeasonRatingSheet, animeId }: MutableAnimeCardSeasonRatingProps) =>
        useAnimeCard({
          anime: { ...baseAnime, _id: animeId },
          onCapMinus: jest.fn(),
          onCapPlus: jest.fn(),
          onOpenSeasonRatingSheet,
          isMutating: false,
        }),
      {
        initialProps: {
          onOpenSeasonRatingSheet: firstOnOpenSeasonRatingSheet,
          animeId: 'anime-1',
        },
      },
    );

    rerender({
      onOpenSeasonRatingSheet: secondOnOpenSeasonRatingSheet,
      animeId: 'anime-2',
    });

    act(() => {
      result.current.handleOpenSeasonRatingSheet();
    });

    expect(firstOnOpenSeasonRatingSheet).not.toHaveBeenCalled();
    expect(secondOnOpenSeasonRatingSheet).toHaveBeenCalledTimes(1);
    expect(secondOnOpenSeasonRatingSheet).toHaveBeenCalledWith('anime-2');
  });
});
