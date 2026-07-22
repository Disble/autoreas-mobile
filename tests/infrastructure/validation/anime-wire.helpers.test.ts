import {
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
  WireAnimeListSchema,
} from '../../../src/infrastructure/validation/anime-schema';

function makeWireAnime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'anime-1',
    name: 'One Piece',
    status: 0,
    episodesWatched: 12,
    totalEpisodes: 24,
    active: 1,
    firstCycle: 0,
    genres: ['accion'],
    days: [{ day: 'Monday', order: 1 }],
    kind: 3,
    lastWatchedAt: 1710000000000,
    premieredAt: 1710000001000,
    createdAt: 1710000002000,
    deletedAt: null,
    cover: 'cover.jpg',
    sourceUrl: 'https://example.com/anime-1',
    folder: 'anime-1',
    studios: 'Bones',
    origin: 'Manga',
    durationMinutes: 24,
    ...overrides,
  };
}

describe('anime wire helpers', () => {
  it('mapea el DTO wire en inglés al modelo legacy en español sin renombrar SQLite ni dominio', () => {
    const mapped = mapWireAnimeToLegacyAnime(makeWireAnime());

    expect(mapped).toEqual({
      _id: 'anime-1', nombre: 'One Piece', estado: 0, nrocapvisto: 12, totalcap: 24,
      activo: 1, primeravez: 0, generos: ['accion'], dias: [{ dia: 'Monday', orden: 1 }],
      tipo: 3, fechaUltCapVisto: 1710000000000, fechaEstreno: 1710000001000,
      fechaCreacion: 1710000002000, fechaEliminacion: null, portada: 'cover.jpg',
      pagina: 'https://example.com/anime-1', carpeta: 'anime-1', estudios: 'Bones', origen: 'Manga', duracion: 24,
    });
  });

  it('normaliza changed_fields en inglés exactamente una vez y descarta campos no soportados', () => {
    expect(
      normalizeWireAnimeChangedFields([
        'status',
        'episodesWatched',
        'lastWatchedAt',
        'sourceUrl',
        'unsupportedField',
      ])
    ).toEqual(['estado', 'nrocapvisto', 'fechaUltCapVisto', 'pagina']);
  });

  it('falla fuerte cuando un snapshot wire en inglés es inválido y no lo oculta como lista vacía', () => {
    const parsed = WireAnimeListSchema.safeParse([makeWireAnime({ episodesWatched: '12' })]);

    expect(parsed.success).toBe(false);
  });
});
