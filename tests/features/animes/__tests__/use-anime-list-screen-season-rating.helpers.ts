/**
 * Creates one season-aware anime fixture for AnimeListScreen hook tests.
 * The payload mirrors the projected list item shape returned by `useAnimeList`.
 */
export function buildSeasonAwareAnimeListItem() {
  return {
    _id: 'anime-1',
    nombre: 'Blue Box',
    estado: 0,
    nrocapvisto: 3,
    totalcap: 12,
    dias: [{ dia: 'Ver hoy', orden: 1 }],
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
    seasonProjection: {
      seasonId: 'season-2026-q3',
      bridgeRating: 4,
      bridgeRatingSource: 'bridge' as const,
      localIntent: {
        nota: 6,
        ratedAt: 1_752_600_000_000,
        createdAt: 1_752_600_100_000,
        status: 'pending' as const,
        failureKind: null,
      },
    },
  };
}
