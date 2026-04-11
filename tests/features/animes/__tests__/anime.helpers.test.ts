import {
  getAnimeOrderForFilter,
  getDefaultAnimeDayFilter,
  matchesAnimeDayFilter,
  sortAnimesBySelectedDay,
} from "../../../../src/features/animes/anime.helpers";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

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
});
