import type { AnimeListItem } from "../../../../src/features/animes/anime-season.types";

/**
 * Builds one anime list item fixture for renderer hook tests.
 * The helper keeps legacy anime fields and optional season projection together for all render-path assertions.
 */
export function buildAnimeListItemFixture(
  id: string,
  overrides: Partial<AnimeListItem> = {},
): AnimeListItem {
  return {
    _id: id,
    nombre: id,
    estado: 0,
    nrocapvisto: 0,
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
    seasonProjection: null,
    ...overrides,
  };
}
