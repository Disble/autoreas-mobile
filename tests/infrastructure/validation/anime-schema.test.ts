import { z } from 'zod';
import { AnimeSchema } from '../../../src/infrastructure/validation/anime-schema';

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

  it('extrae fechas legacy con $$date', () => {
    const parsed = AnimeSchema.parse({
      ...minimalAnime,
      fechaUltCapVisto: { $$date: 1710000000000 },
    });

    expect(parsed.fechaUltCapVisto).toBe(1710000000000);
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
