import { z } from 'zod';
import {
  AnimeSchema,
  WireAnimeSchema,
} from '../../../src/infrastructure/validation/anime-schema';

const minimalAnime = {
  _id: 'anime-1',
  nombre: 'Fullmetal Alchemist',
  estado: 0,
  nrocapvisto: 0,
  activo: 1,
  primeravez: 0,
  generos: ['accion'],
  dias: [{ dia: 'lunes', orden: 1 }],
};

describe('AnimeSchema', () => {
  it('acepta nrocapvisto float sin redondear', () => {
    const parsed = AnimeSchema.parse({ ...minimalAnime, nrocapvisto: 0.5 });

    expect(parsed.nrocapvisto).toBe(0.5);
  });

  it('acepta fechas legacy locales como números', () => {
    const parsed = AnimeSchema.parse({
      ...minimalAnime,
      fechaUltCapVisto: 1710000000000,
    });

    expect(parsed.fechaUltCapVisto).toBe(1710000000000);
  });

  it('rechaza $$date en el contrato wire en inglés', () => {
    expect(() =>
      WireAnimeSchema.parse({
        id: 'anime-1',
        name: 'Fullmetal Alchemist',
        status: 0,
        episodesWatched: 3,
        active: 1,
        firstCycle: 0,
        genres: ['accion'],
        days: [{ day: 'Monday', order: 1 }],
        lastWatchedAt: { $$date: 1710000000000 },
      })
    ).toThrow(z.ZodError);
  });

  it('acepta timestamps numéricos en el contrato wire en inglés', () => {
    const parsed = WireAnimeSchema.parse({
      id: 'anime-1',
      name: 'Fullmetal Alchemist',
      status: 0,
      episodesWatched: 3,
      active: 1,
      firstCycle: 0,
      genres: ['accion'],
      days: [{ day: 'Monday', order: 1 }],
      lastWatchedAt: 1710000000000,
    });

    expect(parsed.lastWatchedAt).toBe(1710000000000);
  });

  it('coerciona generos vacio a array vacio', () => {
    const parsed = AnimeSchema.parse({ ...minimalAnime, generos: '' });

    expect(parsed.generos).toEqual([]);
  });

  it('coerciona dias vacio a array vacio', () => {
    const parsed = AnimeSchema.parse({ ...minimalAnime, dias: '' });

    expect(parsed.dias).toEqual([]);
  });

  it('rechaza estado fuera de rango', () => {
    expect(() => AnimeSchema.parse({ ...minimalAnime, estado: 5 })).toThrow(z.ZodError);
  });

  it('rechaza nrocapvisto no numerico', () => {
    expect(() =>
      AnimeSchema.parse({ ...minimalAnime, nrocapvisto: 'tres' })
    ).toThrow(z.ZodError);
  });
});
