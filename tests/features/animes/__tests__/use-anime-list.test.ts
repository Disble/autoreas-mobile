import { renderHook } from "@testing-library/react-native";
import { useAnimeList } from "../../../../src/features/animes/use-anime-list";
import type { AnimeRow } from "../../../../src/infrastructure/db/schema";

const mockUseOptionalSQLiteContext = jest.fn();
const mockUseOptionalLiveQuery = jest.fn();
const mockCreateDrizzleDb = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();
const mockWhere = jest.fn();

jest.mock("../../../../src/infrastructure/db/native-runtime", () => ({
  useOptionalSQLiteContext: () => mockUseOptionalSQLiteContext(),
  useOptionalLiveQuery: (...args: unknown[]) =>
    mockUseOptionalLiveQuery(...args),
}));

jest.mock("../../../../src/infrastructure/db/client", () => ({
  createDrizzleDb: (...args: unknown[]) => mockCreateDrizzleDb(...args),
}));

function buildRow(overrides: Partial<AnimeRow> = {}): AnimeRow {
  return {
    _id: "anime-1",
    nombre: "Anime",
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: "[]",
    generos: "[]",
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
    ...overrides,
  };
}

describe("useAnimeList", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseOptionalSQLiteContext.mockReturnValue({ name: "raw-db" });
    mockWhere.mockReturnValue({ query: "active-animes" });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockCreateDrizzleDb.mockReturnValue({ select: mockSelect });
  });

  it("filtra por día y ordena por dias[].orden ascendente", () => {
    mockUseOptionalLiveQuery.mockReturnValue({
      data: [
        buildRow({
          _id: "anime-3",
          nombre: "Zeta",
          dias: JSON.stringify([{ dia: "Jueves", orden: 2 }]),
        }),
        buildRow({
          _id: "anime-2",
          nombre: "Bleach",
          dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
        }),
        buildRow({
          _id: "anime-1",
          nombre: "Attack on Titan",
          dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
        }),
        buildRow({
          _id: "anime-out",
          nombre: "Outside",
          dias: JSON.stringify([{ dia: "Viernes", orden: 1 }]),
        }),
      ],
    });

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data.map((anime) => anime._id)).toEqual([
      "anime-1",
      "anime-2",
      "anime-3",
    ]);
    expect(mockCreateDrizzleDb).toHaveBeenCalledWith({ name: "raw-db" });
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("filtra pseudo-días de estrenos usando dias[].dia", () => {
    mockUseOptionalLiveQuery.mockReturnValue({
      data: [
        buildRow({
          _id: "anime-seen",
          nombre: "Seen",
          dias: JSON.stringify([{ dia: "Visto", orden: 3 }]),
        }),
        buildRow({
          _id: "anime-today",
          nombre: "Today",
          dias: JSON.stringify([{ dia: "Ver hoy", orden: 1 }]),
        }),
        buildRow({
          _id: "anime-later",
          nombre: "Later",
          dias: JSON.stringify([{ dia: "Sin ver", orden: 2 }]),
        }),
      ],
    });

    const { result } = renderHook(() => useAnimeList("Ver hoy"));

    expect(result.current.data.map((anime) => anime._id)).toEqual([
      "anime-today",
    ]);
    expect(result.current.data[0]?.dias).toEqual([
      { dia: "Ver hoy", orden: 1 },
    ]);
  });

  it("mantiene animes no-Viendo disponibles en el dataset expuesto", () => {
    mockUseOptionalLiveQuery.mockReturnValue({
      data: [
        buildRow({
          _id: "anime-watching",
          nombre: "Watching",
          estado: 0,
          dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
        }),
        buildRow({
          _id: "anime-completed",
          nombre: "Completed",
          estado: 1,
          dias: JSON.stringify([{ dia: "Jueves", orden: 0 }]),
        }),
      ],
    });

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.allActiveAnimes.map((anime) => anime._id)).toEqual([
      "anime-watching",
      "anime-completed",
    ]);
    expect(result.current.data.map((anime) => anime._id)).toEqual([
      "anime-completed",
      "anime-watching",
    ]);
  });
});
