import {
  loadGuardMap,
  loadPendingOutboxRecordIds,
} from "../../../../src/features/sync/merge/merge-context.helpers";
import { animes, operationLog } from "../../../../src/infrastructure/db/schema";

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((column, value) => ({ column, value })),
  inArray: jest.fn((column, values) => ({ column, values })),
}));

describe("loadGuardMap", () => {
  it("selecciona _id y last_applied_change_ms filtrando por los recordIds dados", async () => {
    const rows = [
      { _id: "anime-1", lastAppliedChangeMs: 100 },
      { _id: "anime-2", lastAppliedChangeMs: null },
    ];
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadGuardMap(db, ["anime-1", "anime-2"]);

    expect(select).toHaveBeenCalledWith({
      _id: animes._id,
      lastAppliedChangeMs: animes.lastAppliedChangeMs,
    });
    expect(from).toHaveBeenCalledWith(animes);
    expect(result.get("anime-1")).toBe(100);
    expect(result.get("anime-2")).toBe(null);
  });

  it("recordIds vacío retorna un mapa vacío sin consultar la base", async () => {
    const select = jest.fn();
    const db = { select } as never;

    const result = await loadGuardMap(db, []);

    expect(select).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("un recordId sin fila correspondiente simplemente no aparece en el mapa", async () => {
    const where = jest.fn().mockResolvedValue([{ _id: "anime-1", lastAppliedChangeMs: 50 }]);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadGuardMap(db, ["anime-1", "anime-missing"]);

    expect(result.has("anime-1")).toBe(true);
    expect(result.has("anime-missing")).toBe(false);
  });
});

describe("loadPendingOutboxRecordIds", () => {
  it("retorna el set de anime_id con status pending o processing en operation_log", async () => {
    const rows = [
      { animeId: "anime-1" },
      { animeId: "anime-2" },
    ];
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadPendingOutboxRecordIds(db);

    expect(select).toHaveBeenCalledWith({ animeId: operationLog.animeId });
    expect(from).toHaveBeenCalledWith(operationLog);
    expect(result.has("anime-1")).toBe(true);
    expect(result.has("anime-2")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("deduplica anime_id repetidos (varias ops pendientes para el mismo anime)", async () => {
    const rows = [{ animeId: "anime-1" }, { animeId: "anime-1" }];
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadPendingOutboxRecordIds(db);

    expect(result.size).toBe(1);
  });

  it("sin filas pendientes retorna un set vacío", async () => {
    const where = jest.fn().mockResolvedValue([]);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as never;

    const result = await loadPendingOutboxRecordIds(db);

    expect(result.size).toBe(0);
  });
});
