import {
  buildCapMinusPatch,
  buildCapPlusPatch,
  serializeMutationOperation,
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
});
