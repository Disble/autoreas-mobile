import {
  mapWireAnimeToIngestedAnime,
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
  WireAnimeListSchema,
} from '../../../src/infrastructure/validation/anime-schema';

/** Builds a fixture English bridge wire anime record, including the required OCC token. */
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
    modified_at: 0,
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
      episodes: null,
      folderRelative: null,
    });
  });

  it('maps the bridge folder path below its library root into the domain shape', () => {
    const mapped = mapWireAnimeToLegacyAnime(makeWireAnime({ folderRelative: 'Anime/One Piece' }) as never);

    expect(mapped.folderRelative).toBe('Anime/One Piece');
  });

  it('drops folderRelative from changed_fields, since the bridge only sends it alongside folder', () => {
    expect(normalizeWireAnimeChangedFields(['folder', 'folderRelative'])).toEqual(['carpeta']);
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

  it('maps the episodes array, sorted as the bridge sends it, into the domain shape', () => {
    const mapped = mapWireAnimeToLegacyAnime(
      makeWireAnime({
        episodes: [
          { episode: 1, minutes: 24, long: false },
          { episode: 2, minutes: 46, long: true },
        ],
      }) as never,
    );

    expect(mapped.episodes).toEqual([
      { episode: 1, minutes: 24, long: false },
      { episode: 2, minutes: 46, long: true },
    ]);
  });

  it('treats a malformed episodes value as absent instead of failing the whole snapshot', () => {
    const parsed = WireAnimeListSchema.safeParse([
      makeWireAnime({ episodes: [{ episode: '1', minutes: 24, long: false }] }),
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && mapWireAnimeToLegacyAnime(parsed.data[0]).episodes).toBeNull();
  });

  it('keeps episodes when normalizing changed_fields so a durations-only update is applied', () => {
    expect(normalizeWireAnimeChangedFields(['episodes'])).toEqual(['episodes']);
  });

  it('falla fuerte cuando un snapshot wire en inglés es inválido y no lo oculta como lista vacía', () => {
    const parsed = WireAnimeListSchema.safeParse([makeWireAnime({ episodesWatched: '12' })]);

    expect(parsed.success).toBe(false);
  });

  describe('mapWireAnimeToIngestedAnime', () => {
    it('pairs a byte-identical mapWireAnimeToLegacyAnime output with the wire record bridgeModifiedAt', () => {
      const wire = makeWireAnime({ modified_at: 1788540735366 });

      const ingested = mapWireAnimeToIngestedAnime(wire);

      expect(ingested.anime).toEqual(mapWireAnimeToLegacyAnime(wire));
      expect(ingested.bridgeModifiedAt).toBe(1788540735366);
    });

    it('preserves a modified_at of 0 as a real token, not dropped or replaced', () => {
      const wire = makeWireAnime({ modified_at: 0 });

      const ingested = mapWireAnimeToIngestedAnime(wire);

      expect(ingested.bridgeModifiedAt).toBe(0);
    });
  });
});
