import {
  getAnimeOrderForFilter,
  getDefaultAnimeDayFilter,
  isAnimePseudoDayFilter,
  matchesAnimeDayFilter,
  parseAnimeRow,
  sortAnimesBySelectedDay,
} from "../../../../src/features/animes/anime.helpers";
import { AnimeSchema, type Anime } from "../../../../src/infrastructure/validation/anime-schema";
import type { AnimeRow } from "../../../../src/infrastructure/db/schema";

/** Frozen domain key list `parseAnimeRow`'s output must match exactly -- no sync-internal leak. */
const FROZEN_ANIME_DOMAIN_KEYS = [
  "_id",
  "activo",
  "carpeta",
  "dias",
  "duracion",
  "estado",
  "estudios",
  "fechaCreacion",
  "fechaEliminacion",
  "fechaEstreno",
  "fechaUltCapVisto",
  "generos",
  "nombre",
  "nrocapvisto",
  "origen",
  "pagina",
  "portada",
  "primeravez",
  "tipo",
  "totalcap",
].sort();

/** Builds a fixture `AnimeRow`, as it would come back from a raw SQLite select. */
function buildAnimeRow(overrides: Partial<AnimeRow> = {}): AnimeRow {
  return {
    _id: "anime-1",
    nombre: "Anime",
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: null,
    generos: null,
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
    lastAppliedChangeMs: null,
    bridgeModifiedAt: null,
    ...overrides,
  };
}

/** Builds a fixture domain `Anime`. */
function buildAnime(overrides: Partial<Anime> = {}): Anime {
  return {
    _id: "anime-1",
    nombre: "Anime",
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
    ...overrides,
  };
}

describe("anime.helpers", () => {
  it("resuelve el filtro inicial con el día actual", () => {
    const result = getDefaultAnimeDayFilter(
      new Date("2026-04-09T10:00:00.000Z"),
    );

    expect(result).toBe("Jueves");
  });

  it("resuelve el filtro inicial a 'Ver hoy' cuando el modo temporada está activo", () => {
    const result = getDefaultAnimeDayFilter(
      new Date("2026-04-09T10:00:00.000Z"),
      true,
    );

    expect(result).toBe("Ver hoy");
  });

  it("ignora el modo temporada cuando está desactivado y usa el día actual", () => {
    const result = getDefaultAnimeDayFilter(
      new Date("2026-04-09T10:00:00.000Z"),
      false,
    );

    expect(result).toBe("Jueves");
  });

  it("detecta matches y devuelve el orden del filtro seleccionado", () => {
    const anime = buildAnime({
      dias: [
        { dia: "Jueves", orden: 3 },
        { dia: "Ver hoy", orden: 1 },
      ],
    });

    expect(matchesAnimeDayFilter(anime, "Jueves")).toBe(true);
    expect(matchesAnimeDayFilter(anime, "Viernes")).toBe(false);
    expect(getAnimeOrderForFilter(anime, "Jueves")).toBe(3);
    expect(getAnimeOrderForFilter(anime, "Visto")).toBeNull();
  });

  it("ordena por orden ascendente y excluye animes sin mapping del filtro activo", () => {
    const sorted = sortAnimesBySelectedDay(
      [
        buildAnime({
          _id: "anime-z",
          nombre: "Zeta",
          dias: [{ dia: "Jueves", orden: 2 }],
        }),
        buildAnime({
          _id: "anime-b",
          nombre: "Bleach",
          dias: [{ dia: "Jueves", orden: 1 }],
        }),
        buildAnime({
          _id: "anime-a",
          nombre: "Attack on Titan",
          dias: [{ dia: "Jueves", orden: 1 }],
        }),
        buildAnime({
          _id: "anime-out",
          nombre: "Outside",
          dias: [{ dia: "Viernes", orden: 1 }],
        }),
        buildAnime({
          _id: "anime-completed",
          nombre: "Completed",
          estado: 1,
          dias: [{ dia: "Jueves", orden: 0 }],
        }),
      ],
      "Jueves",
    );

    expect(sorted.map((anime) => anime._id)).toEqual([
      "anime-completed",
      "anime-a",
      "anime-b",
      "anime-z",
    ]);
  });

  describe("isAnimePseudoDayFilter", () => {
    it.each(["Sin ver", "Ver hoy", "Visto"] as const)(
      "treats %s as an Estrenos pseudo-day filter",
      (filter) => {
        expect(isAnimePseudoDayFilter(filter)).toBe(true);
      },
    );

    it.each(["Lunes", "Viernes", "Domingo"] as const)(
      "treats %s as a weekday filter",
      (filter) => {
        expect(isAnimePseudoDayFilter(filter)).toBe(false);
      },
    );
  });

  describe("parseAnimeRow", () => {
    it("never leaks bridgeModifiedAt (or any sync-internal column) onto the domain shape", () => {
      const rowWithToken = buildAnimeRow({ bridgeModifiedAt: 1788540735366, lastAppliedChangeMs: 500 });

      const parsed = parseAnimeRow(rowWithToken);

      expect(Object.keys(parsed).sort()).toEqual(FROZEN_ANIME_DOMAIN_KEYS);
      expect(parsed).not.toHaveProperty("bridgeModifiedAt");
      expect(parsed).not.toHaveProperty("lastAppliedChangeMs");
    });

    it("parses dias and generos JSON columns as before", () => {
      const row = buildAnimeRow({
        dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
        generos: JSON.stringify(["accion"]),
      });

      const parsed = parseAnimeRow(row);

      expect(parsed.dias).toEqual([{ dia: "Jueves", orden: 1 }]);
      expect(parsed.generos).toEqual(["accion"]);
    });

    it("still strips the token via AnimeSchema's default zod strip mode (pins anime-mutation.helpers.ts's fetchParsedAnime path)", () => {
      const parsed = AnimeSchema.parse({
        ...buildAnimeRow({ bridgeModifiedAt: 1788540735366 }),
        dias: [],
        generos: [],
      });

      expect(parsed).not.toHaveProperty("bridgeModifiedAt");
    });
  });
});
