import { renderHook } from '@testing-library/react-native';
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
});
