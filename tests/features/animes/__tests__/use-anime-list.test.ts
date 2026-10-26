import { act, renderHook } from "@testing-library/react-native";
import {
  acceptAnimeMutationProjection,
  getAnimeMutationProjectionState,
  resetAnimeMutationProjection,
} from "../../../../src/features/animes/anime-mutation-projection.helpers";
import { useAnimeList } from "../../../../src/features/animes/use-anime-list";
import type { AnimeRow } from "../../../../src/infrastructure/db/schema";

/** Mocks `useOptionalSQLiteContext`, controlling whether a raw SQLite connection is available. */
const mockUseOptionalSQLiteContext = jest.fn();
/** Mocks `useOptionalLiveQuery`, feeding fixture rows to the hook under test. */
const mockUseOptionalLiveQuery = jest.fn();
/** Mocks `createDrizzleDb`, standing in for the real drizzle factory. */
const mockCreateDrizzleDb = jest.fn();
/** Spy for the query chain's `.where()`: both live queries are built through it, and a case counts them. */
const mockWhere = jest.fn();

jest.mock("../../../../src/infrastructure/db/native-runtime", () => ({
  useOptionalSQLiteContext: () => mockUseOptionalSQLiteContext(),
  useOptionalLiveQuery: (...args: unknown[]) =>
    mockUseOptionalLiveQuery(...args),
}));

jest.mock("../../../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
  useOptionalSQLiteContext: () => mockUseOptionalSQLiteContext(),
  useOptionalLiveQuery: (...args: unknown[]) =>
    mockUseOptionalLiveQuery(...args),
}));

jest.mock("../../../../src/infrastructure/db/client", () => ({
  createDrizzleDb: (...args: unknown[]) => mockCreateDrizzleDb(...args),
}));

jest.mock("../../../../src/infrastructure/db/client/client.helpers", () => ({
  createDrizzleDb: (...args: unknown[]) => mockCreateDrizzleDb(...args),
}));

/** Builds a fixture `AnimeRow`, as it would come back from a raw SQLite select. */
function buildRow(overrides: Partial<AnimeRow> = {}): AnimeRow {
  return {
    _id: "anime-1",
    nombre: "Anime",
    estado: 0,
    nrocapvisto: 0,
    totalcap: null,
    dias: "[]",
    generos: "[]",
    episodes: null,
    season: null,
    folderRelative: null,
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

/** Queues the fixture anime rows and outbox `season_rating` rows the next `useOptionalLiveQuery` calls return. */
function mockLiveQueryData(animeRows: AnimeRow[], seasonQueueRows: readonly unknown[] = []) {
  mockUseOptionalLiveQuery
    .mockImplementationOnce(() => ({ data: animeRows }))
    .mockImplementationOnce(() => ({ data: seasonQueueRows }));
}

/**
 * Queues the same live-query pair for every render, for cases that expect one.
 * The hook asks for the active animes and then for the queued season ratings, once per render, so
 * a projection change -- which re-renders without any database write -- would otherwise exhaust a
 * two-entry queue and receive `undefined`.
 */
function mockLiveQueryDataUntilChanged(
  animeRows: AnimeRow[],
  seasonQueueRows: readonly unknown[] = [],
) {
  let callIndex = 0;

  mockUseOptionalLiveQuery.mockImplementation(() => {
    const isAnimeQuery = callIndex % 2 === 0;
    callIndex += 1;

    return { data: isAnimeQuery ? animeRows : seasonQueueRows };
  });
}

describe("useAnimeList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAnimeMutationProjection();
    mockUseOptionalSQLiteContext.mockReturnValue({ name: "raw-db" });
    mockWhere.mockReturnValue({ query: "active-animes" });
    mockCreateDrizzleDb.mockReturnValue({
      select: () => ({ from: () => ({ where: mockWhere }) }),
    });
  });

  it("filtra por día y ordena por dias[].orden ascendente", () => {
    mockLiveQueryData([
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
      ]);

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data.map((anime) => anime._id)).toEqual([
      "anime-1",
      "anime-2",
      "anime-3",
    ]);
    expect(mockCreateDrizzleDb).toHaveBeenCalledWith({ name: "raw-db" });
    // One filter for the active animes, one for the queued season ratings of the outbox (L28).
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it("filtra pseudo-días de estrenos usando dias[].dia", () => {
    mockLiveQueryData([
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
      ]);

    const { result } = renderHook(() => useAnimeList("Ver hoy"));

    expect(result.current.data.map((anime) => anime._id)).toEqual([
      "anime-today",
    ]);
    expect(result.current.data[0]?.dias).toEqual([
      { dia: "Ver hoy", orden: 1 },
    ]);
    expect(result.current.data[0]?.seasonProjection).toBeNull();
  });

  it("mantiene animes no-Viendo disponibles en el dataset expuesto", () => {
    mockLiveQueryData([
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
      ]);

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

  it.each(["Ver hoy", "Visto", "Sin ver"] as const)(
    "does not infer a season projection for %s while offline snapshot data is unavailable",
    (filter) => {
    mockLiveQueryData([
      buildRow({
          _id: "anime-estrenos",
          nombre: "Estrenos",
          dias: JSON.stringify([{ dia: filter, orden: 1 }]),
      }),
    ]);

      const { result } = renderHook(() => useAnimeList(filter));

      expect(result.current.data[0]?.seasonProjection).toBeNull();
    },
  );

  it("has no season projection for an anime that is not a candidate", () => {
    mockLiveQueryData([
      buildRow({
        _id: "anime-weekday",
        nombre: "Weekday",
        dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
      }),
    ]);

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data[0]?.seasonProjection).toBeNull();
  });

  it("projects the anime's stored candidacy, its grade as the bridge rating", () => {
    mockLiveQueryData([
      buildRow({
        _id: "anime-1",
        dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
        season: '{"seasonId":"season-7","grade":3}',
      }),
    ]);

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data[0]?.seasonProjection).toEqual({
      seasonId: "season-7",
      bridgeRating: 3,
      localIntent: null,
    });
  });

  it("projects a queued season rating of the anime's season from the outbox as its local intent", () => {
    mockLiveQueryData(
      [
        buildRow({
          _id: "anime-1",
          dias: JSON.stringify([{ dia: "Jueves", orden: 1 }]),
          season: '{"seasonId":"season-7","grade":null}',
        }),
      ],
      [
        {
          id: 4,
          animeId: "anime-1",
          operation: "season_rating",
          payload: JSON.stringify({ seasonId: "season-7", grade: 5, ratedAt: 10 }),
          status: "dead_letter",
          createdAt: 20,
          conflictAttemptCount: 0,
          claimOwner: null,
          claimedAt: null,
          unresolvedReason: "conflict",
        },
      ],
    );

    const { result } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data[0]?.seasonProjection?.localIntent).toEqual({
      nota: 5,
      ratedAt: 10,
      createdAt: 20,
      status: "failed",
      failureKind: "conflict",
    });
  });

  it("proyecta un capítulo aceptado y lo retira cuando la fila durable deja de ser la que lo originó", () => {
    const jueves = JSON.stringify([{ dia: "Jueves", orden: 1 }]);
    mockLiveQueryDataUntilChanged([
      buildRow({ _id: "anime-1", nrocapvisto: 1, totalcap: 12, dias: jueves }),
    ]);
    const { result, rerender } = renderHook(() => useAnimeList("Jueves"));

    expect(result.current.data[0]?.nrocapvisto).toBe(1);

    // The chapter the user pressed, accepted before any write was acknowledged.
    act(() => {
      acceptAnimeMutationProjection("anime-1", () => ({ nrocapvisto: 2, estado: 0 }));
    });

    expect(result.current.data[0]?.nrocapvisto).toBe(2);

    // A newer durable value (a later write or a correction) is not masked by the stale intent.
    mockLiveQueryDataUntilChanged([
      buildRow({ _id: "anime-1", nrocapvisto: 3, totalcap: 12, dias: jueves }),
    ]);
    rerender({});

    expect(result.current.data[0]?.nrocapvisto).toBe(3);

    // A +1 followed by a -1: the chain ends on the value the row already carries, so the row has
    // absorbed it and nothing may be kept. Retaining it would pile one entry pair per tap cycle for
    // the whole session, which is exactly what an independent review reproduced.
    act(() => {
      acceptAnimeMutationProjection("anime-1", () => ({ nrocapvisto: 4, estado: 0 }));
      acceptAnimeMutationProjection("anime-1", () => ({ nrocapvisto: 3, estado: 0 }));
    });

    expect(result.current.data[0]?.nrocapvisto).toBe(3);
    expect(getAnimeMutationProjectionState().byAnimeId["anime-1"]?.entries).toHaveLength(2);

    // The row settles on the value the chain folds to, so every entry of that chain retires.
    mockLiveQueryDataUntilChanged([
      buildRow({ _id: "anime-1", nrocapvisto: 3, totalcap: 12, dias: jueves }),
    ]);
    rerender({});

    expect(result.current.data[0]?.nrocapvisto).toBe(3);
    expect(getAnimeMutationProjectionState().byAnimeId["anime-1"]?.entries).toHaveLength(0);
  });

  it("keeps the item object of an anime whose row a database write left unchanged", () => {
    const jueves = JSON.stringify([{ dia: "Jueves", orden: 1 }]);
    mockLiveQueryData([
      buildRow({ _id: "anime-1", dias: jueves }),
      buildRow({ _id: "anime-2", dias: jueves }),
    ]);
    const { result, rerender } = renderHook(() => useAnimeList("Jueves"));
    const [firstBefore, secondBefore] = result.current.data;

    mockLiveQueryData([
      buildRow({ _id: "anime-1", dias: jueves }),
      buildRow({ _id: "anime-2", dias: jueves, nrocapvisto: 4 }),
    ]);
    rerender({});

    expect(result.current.data[0]).toBe(firstBefore);
    expect(result.current.data[1]).not.toBe(secondBefore);
    expect(result.current.data[1]?.nrocapvisto).toBe(4);
  });
});
