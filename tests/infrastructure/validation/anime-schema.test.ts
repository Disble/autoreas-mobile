import { z } from 'zod';
import {
  AnimeSchema,
  WireAnimeSchema,
} from '../../../src/infrastructure/validation/anime-schema';

/** Minimal valid domain `Anime` fixture, extended per test via spread overrides. */
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

  it('acepta null explícito en un campo de fecha legacy', () => {
    const parsed = AnimeSchema.parse({
      ...minimalAnime,
      fechaEstreno: null,
    });

    expect(parsed.fechaEstreno).toBeNull();
  });

  it('coerciona un timestamp numérico almacenado como string a number', () => {
    const parsed = AnimeSchema.parse({
      ...minimalAnime,
      fechaCreacion: '1710000000000',
    });

    expect(parsed.fechaCreacion).toBe(1710000000000);
  });

  it('coerciona un timestamp negativo o decimal almacenado como string', () => {
    expect(
      AnimeSchema.parse({ ...minimalAnime, fechaCreacion: '-5' }).fechaCreacion,
    ).toBe(-5);
    expect(
      AnimeSchema.parse({ ...minimalAnime, fechaCreacion: '1.5' }).fechaCreacion,
    ).toBe(1.5);
  });

  it('desenvuelve el formato legado Mongo $$date a su número interno', () => {
    const parsed = AnimeSchema.parse({
      ...minimalAnime,
      fechaEliminacion: { $$date: 1710000000000 },
    });

    expect(parsed.fechaEliminacion).toBe(1710000000000);
  });

  it('rechaza un valor de fecha que no matchea ningún preprocesamiento reconocido (ni número, ni numeric-string, ni $$date)', () => {
    const result = AnimeSchema.safeParse({
      ...minimalAnime,
      fechaUltCapVisto: 'not-a-timestamp',
    });

    expect(result.success).toBe(false);
  });

  it('deja pasar sin transformar un objeto que no matchea la forma $$date (falls through al passthrough final)', () => {
    // Has the `$$date` key but with a non-number value: fails the `typeof value.$$date ===
    // 'number'` guard, so the preprocessor's final `return value;` passes the object through
    // unchanged, and Zod's own `z.number().nullable()` then rejects the object shape.
    const result = AnimeSchema.safeParse({
      ...minimalAnime,
      fechaUltCapVisto: { $$date: 'not-a-number' },
    });

    expect(result.success).toBe(false);
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

  it('coerciona genres/days vacío (string legado) a array vacío en el contrato wire', () => {
    const parsed = WireAnimeSchema.parse({
      id: 'anime-1',
      name: 'Fullmetal Alchemist',
      status: 0,
      episodesWatched: 3,
      active: 1,
      firstCycle: 0,
      genres: '',
      days: '',
      modified_at: 1788540735366,
    });

    expect(parsed.genres).toEqual([]);
    expect(parsed.days).toEqual([]);
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
      modified_at: 1788540735366,
    });

    expect(parsed.lastWatchedAt).toBe(1710000000000);
  });

  it('survives a listAnimes wire record modified_at through the parse boundary', () => {
    const parsed = WireAnimeSchema.parse({
      id: 'anime-1',
      name: 'Fullmetal Alchemist',
      status: 0,
      episodesWatched: 3,
      active: 1,
      firstCycle: 0,
      genres: ['accion'],
      days: [{ day: 'Monday', order: 1 }],
      modified_at: 1788540735366,
    });

    expect(parsed.modified_at).toBe(1788540735366);
  });

  it('parses a zero modified_at to exactly 0, not dropped or replaced', () => {
    const parsed = WireAnimeSchema.parse({
      id: 'anime-1',
      name: 'Fullmetal Alchemist',
      status: 0,
      episodesWatched: 3,
      active: 1,
      firstCycle: 0,
      genres: ['accion'],
      days: [{ day: 'Monday', order: 1 }],
      modified_at: 0,
    });

    expect(parsed.modified_at).toBe(0);
  });

  it('rejects a wire record missing modified_at (required, never a silent default)', () => {
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
      })
    ).toThrow(z.ZodError);
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
