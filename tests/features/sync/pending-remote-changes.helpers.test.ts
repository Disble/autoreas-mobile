import {
  deletePendingRemoteChanges,
  loadPendingRemoteChanges,
  stagePendingRemoteChanges,
} from "../../../src/features/sync/pending-remote-changes.helpers";
import { pendingRemoteChanges } from "../../../src/infrastructure/db/schema";
import type { RemoteAnimeChange } from "../../../src/features/sync/merge/merge.types";

jest.mock("drizzle-orm", () => ({
  asc: jest.fn((column) => ({ column, dir: "asc" })),
  inArray: jest.fn((column, values) => ({ column, values })),
}));

function makeChange(overrides: Partial<RemoteAnimeChange> = {}): RemoteAnimeChange {
  return {
    recordId: "anime-1",
    changeType: "update",
    changedFields: ["estado"],
    snapshot: { _id: "anime-1", nombre: "Naruto" } as never,
    timestamp: 100,
    ...overrides,
  };
}

describe("stagePendingRemoteChanges", () => {
  it("inserta una fila por cada change, serializando changed_fields y snapshot como JSON", async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values });
    const db = { insert } as never;
    const now = () => 12345;

    await stagePendingRemoteChanges(db, [makeChange()], now);

    expect(insert).toHaveBeenCalledWith(pendingRemoteChanges);
    expect(values).toHaveBeenCalledWith([
      {
        recordId: "anime-1",
        changeType: "update",
        changedFields: JSON.stringify(["estado"]),
        snapshot: JSON.stringify({ _id: "anime-1", nombre: "Naruto" }),
        timestamp: 100,
        createdAt: 12345,
      },
    ]);
  });

  it("change sin snapshot (delete) persiste snapshot como null", async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values });
    const db = { insert } as never;

    await stagePendingRemoteChanges(
      db,
      [makeChange({ changeType: "delete", snapshot: undefined })],
      () => 1,
    );

    const inserted = values.mock.calls[0][0];
    expect(inserted[0].snapshot).toBe(null);
  });

  it("batch vacío no llama a insert", async () => {
    const insert = jest.fn();
    const db = { insert } as never;

    await stagePendingRemoteChanges(db, [], () => 1);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("loadPendingRemoteChanges", () => {
  it("lee filas ordenadas por timestamp ascendente y las normaliza a RemoteAnimeChange + id de staging", async () => {
    const rows = [
      {
        id: 1,
        recordId: "anime-1",
        changeType: "update",
        changedFields: JSON.stringify(["estado"]),
        snapshot: JSON.stringify({ _id: "anime-1" }),
        timestamp: 100,
        createdAt: 1,
      },
      {
        id: 2,
        recordId: "anime-2",
        changeType: "delete",
        changedFields: JSON.stringify([]),
        snapshot: null,
        timestamp: 200,
        createdAt: 2,
      },
    ];
    const orderBy = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ orderBy });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadPendingRemoteChanges(db);

    expect(from).toHaveBeenCalledWith(pendingRemoteChanges);
    expect(result).toEqual([
      {
        stagingId: 1,
        change: {
          recordId: "anime-1",
          changeType: "update",
          changedFields: ["estado"],
          snapshot: { _id: "anime-1" },
          timestamp: 100,
        },
      },
      {
        stagingId: 2,
        change: {
          recordId: "anime-2",
          changeType: "delete",
          changedFields: [],
          snapshot: undefined,
          timestamp: 200,
        },
      },
    ]);
  });

  it("sin filas en staging retorna un arreglo vacío", async () => {
    const orderBy = jest.fn().mockResolvedValue([]);
    const from = jest.fn().mockReturnValue({ orderBy });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadPendingRemoteChanges(db);

    expect(result).toEqual([]);
  });
});

describe("deletePendingRemoteChanges", () => {
  it("elimina las filas de staging cuyo id está en la lista dada", async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const del = jest.fn().mockReturnValue({ where });
    const db = { delete: del } as never;

    await deletePendingRemoteChanges(db, [1, 2, 3]);

    expect(del).toHaveBeenCalledWith(pendingRemoteChanges);
  });

  it("lista vacía de ids no llama a delete", async () => {
    const del = jest.fn();
    const db = { delete: del } as never;

    await deletePendingRemoteChanges(db, []);

    expect(del).not.toHaveBeenCalled();
  });
});
