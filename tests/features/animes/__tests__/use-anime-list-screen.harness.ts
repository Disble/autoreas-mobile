import type { AnimeDayFilter } from "../../../../src/features/animes/anime.types";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

// This module is the shared, file-scoped half of the `useAnimeListScreen` suite: the mock
// function doubles, the anime fixtures and the builder behind them. Jest cannot share a
// `jest.mock(...)` call across test files -- the registry is per file -- so each test file keeps
// its own mock declarations and imports the doubles from here. The `mock` prefix is load-bearing:
// babel-plugin-jest-hoist only tolerates an out-of-scope identifier inside a module factory when
// its name starts with `mock`, which is why every double below is named that way.

/** Router push spy the mocked `expo-router` hands to the screen. */
export const mockPush = jest.fn();
/** Controls the anime list the mocked `useAnimeList` returns for each day filter. */
export const mockUseAnimeList = jest.fn();
/** Controls the responsive layout the mocked `useResponsiveLayout` reports. */
export const mockUseResponsiveLayout = jest.fn();
/** Fast-increment chapter command spy handed to the screen by the mocked `useMutateAnime`. */
export const mockCapPlus = jest.fn();
/** Fast-decrement chapter command spy. */
export const mockCapMinus = jest.fn();
/** Half-increment chapter command spy. */
export const mockCapPlusHalf = jest.fn();
/** Half-decrement chapter command spy. */
export const mockCapMinusHalf = jest.fn();
/** Estado command spy, used by the state sheet path. */
export const mockSetEstado = jest.fn();
/** Manual sync spy the mocked `useSyncFacade` hands to the screen. */
export const mockManualSync = jest.fn();
/** Toast spy the mocked `useToast` hands to the screen. */
export const mockToastShow = jest.fn();

/**
 * Builds one anime fixture with every persisted field present.
 * Defaults describe a fresh, unwatched anime; `overrides` exists so a case can pin only the
 * field it cares about without restating the other nineteen.
 */
function buildAnime(
  id: string,
  nombre: string,
  dias: Anime["dias"] = [],
  overrides: Partial<Anime> = {},
): Anime {
  return {
    _id: id,
    nombre,
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias,
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
    ...overrides,
  };
}

/** What `useAnimeList` returns per filter: two populated days plus one watched bucket. */
export const animeByFilter: Record<AnimeDayFilter, Anime[]> = {
  Lunes: [],
  Martes: [],
  Miércoles: [],
  Jueves: [
    buildAnime("thu-1", "Thursday Anime", [{ dia: "Jueves", orden: 0 }]),
  ],
  Viernes: [
    buildAnime("fri-1", "Friday Anime", [{ dia: "Viernes", orden: 0 }]),
  ],
  Sábado: [],
  Domingo: [],
  "Sin ver": [],
  "Ver hoy": [],
  Visto: [buildAnime("seen-1", "Seen Anime", [{ dia: "Visto", orden: 0 }])],
};

/**
 * The unfiltered catalogue the screen counts badges from: one Monday+Thursday anime, one
 * Thursday-only anime and one watched anime that is no longer active.
 */
export const allActiveAnimes: Anime[] = [
  buildAnime("a", "Anime A", [
    { dia: "Lunes", orden: 0 },
    { dia: "Jueves", orden: 0 },
  ]),
  buildAnime("b", "Anime B", [{ dia: "Jueves", orden: 1 }]),
  buildAnime("c", "Anime C", [{ dia: "Visto", orden: 0 }], { estado: 1 }),
];
