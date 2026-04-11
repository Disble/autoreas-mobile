import {
  buildCapMinusHalfPatch,
  buildCapMinusPatch,
  buildCapPlusHalfPatch,
  buildCapPlusPatch,
  buildSetEstadoPatch,
  serializeMutationOperation,
  toLocalAnimeUpdate,
} from '../../../src/features/animes/anime-mutation.helpers';
import type { Anime } from '../../../src/infrastructure/validation/anime-schema';

describe('anime mutation helpers', () => {
  const now = 1710000000000;

  const baseAnime: Anime = {
    _id: 'anime-1',
    nombre: 'One Piece',
    estado: 0,
    nrocapvisto: 3,
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

  it('buildCapPlusPatch genera un patch absoluto compatible con bridge', () => {
    expect(buildCapPlusPatch(baseAnime, now)).toEqual({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
    });
  });

  it('buildCapPlusPatch agrega estreno y finalización cuando corresponde', () => {
    expect(
      buildCapPlusPatch(
        {
          ...baseAnime,
          nrocapvisto: 11,
          totalcap: 12,
          primeravez: 1,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      fechaEstreno: now,
      primeravez: false,
      estado: 1,
    });
  });

  it('buildCapMinusPatch nunca baja de cero y mantiene payload absoluto', () => {
    expect(
      buildCapMinusPatch(
        {
          ...baseAnime,
          nrocapvisto: 0,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 0,
      fechaUltCapVisto: now,
    });
  });

  it('buildCapMinusPatch reabre anime auto-finalizado cuando baja desde totalcap', () => {
    expect(
      buildCapMinusPatch(
        {
          ...baseAnime,
          estado: 1,
          nrocapvisto: 12,
          totalcap: 12,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 11,
      fechaUltCapVisto: now,
      estado: 0,
    });
  });

  it('buildSetEstadoPatch envía el nuevo estado sin tocar nrocapvisto cuando no es finalizado', () => {
    expect(buildSetEstadoPatch(baseAnime, 3, now)).toEqual({
      nrocapvisto: 3,
      fechaUltCapVisto: now,
      estado: 3,
    });
  });

  it('buildSetEstadoPatch snapea nrocapvisto a totalcap cuando se marca finalizado y hay totalcap', () => {
    expect(
      buildSetEstadoPatch(
        {
          ...baseAnime,
          nrocapvisto: 5,
          totalcap: 12,
        },
        1,
        now,
      ),
    ).toEqual({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      estado: 1,
    });
  });

  it('buildSetEstadoPatch deja nrocapvisto intacto cuando se marca finalizado sin totalcap', () => {
    expect(
      buildSetEstadoPatch(
        {
          ...baseAnime,
          nrocapvisto: 7,
          totalcap: null,
        },
        1,
        now,
      ),
    ).toEqual({
      nrocapvisto: 7,
      fechaUltCapVisto: now,
      estado: 1,
    });
  });

  it('buildCapPlusHalfPatch suma medio capítulo desde un entero', () => {
    expect(buildCapPlusHalfPatch(baseAnime, now)).toEqual({
      nrocapvisto: 3.5,
      fechaUltCapVisto: now,
    });
  });

  it('buildCapPlusHalfPatch completa un capítulo cuando ya estaba en .5', () => {
    expect(
      buildCapPlusHalfPatch(
        {
          ...baseAnime,
          nrocapvisto: 3.5,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
    });
  });

  it('buildCapPlusHalfPatch autofinaliza cuando el medio cap llega a totalcap', () => {
    expect(
      buildCapPlusHalfPatch(
        {
          ...baseAnime,
          nrocapvisto: 11.5,
          totalcap: 12,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 12,
      fechaUltCapVisto: now,
      estado: 1,
    });
  });

  it('buildCapMinusHalfPatch nunca baja de cero', () => {
    expect(
      buildCapMinusHalfPatch(
        {
          ...baseAnime,
          nrocapvisto: 0,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 0,
      fechaUltCapVisto: now,
    });
  });

  it('buildCapMinusHalfPatch resta medio capítulo y reabre finalizado al bajar desde totalcap', () => {
    expect(
      buildCapMinusHalfPatch(
        {
          ...baseAnime,
          estado: 1,
          nrocapvisto: 12,
          totalcap: 12,
        },
        now,
      ),
    ).toEqual({
      nrocapvisto: 11.5,
      fechaUltCapVisto: now,
      estado: 0,
    });
  });

  it('serializeMutationOperation normaliza al contrato update', () => {
    expect(
      serializeMutationOperation({
        nrocapvisto: 4,
        fechaUltCapVisto: now,
      }),
    ).toEqual({
      operation: 'update',
      payload: JSON.stringify({
        nrocapvisto: 4,
        fechaUltCapVisto: now,
      }),
    });
  });

  it('toLocalAnimeUpdate incluye sólo campos opcionales presentes y normaliza primeravez', () => {
    expect(
      toLocalAnimeUpdate({
        nrocapvisto: 4,
        fechaUltCapVisto: now,
        fechaEstreno: now,
        primeravez: false,
      }),
    ).toEqual({
      nrocapvisto: 4,
      fechaUltCapVisto: now,
      fechaEstreno: now,
      primeravez: 0,
    });
  });
});
