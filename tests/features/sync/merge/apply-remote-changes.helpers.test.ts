import { applyRemoteChanges } from "../../../../src/features/sync/merge/apply-remote-changes.helpers";
import { applyAnimePartial, upsertAnime } from "../../../../src/infrastructure/db/anime-repository";
import { animes } from "../../../../src/infrastructure/db/schema";
import type {
  MergeContext,
  RemoteAnimeChange,
} from "../../../../src/features/sync/merge/merge.types";

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((column, value) => ({ column, value })),
}));

jest.mock("../../../../src/infrastructure/db/anime-repository", () => ({
  applyAnimePartial: jest.fn().mockResolvedValue(undefined),
  upsertAnime: jest.fn().mockResolvedValue(undefined),
}));

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "anime-1",
    nombre: "Naruto",
    estado: 1,
    nrocapvisto: 0,
    totalcap: 220,
    dias: [],
    generos: [],
    tipo: 1,
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
  } as never;
}

function makeChange(overrides: Partial<RemoteAnimeChange> = {}): RemoteAnimeChange {
  return {
    recordId: "anime-1",
    changeType: "update",
    changedFields: ["estado"],
    snapshot: makeSnapshot(),
    timestamp: 100,
    ...overrides,
  };
}

function makeContext(overrides: Partial<MergeContext> = {}): MergeContext {
  return {
    guardByRecordId: new Map(),
    pendingOutboxRecordIds: new Set(),
    ...overrides,
  };
}

describe("applyRemoteChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("change_type update aplica un partial update y estampa el guard (apply)", async () => {
    const change = makeChange({ changedFields: ["estado"], timestamp: 150 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });
    const db = {} as never;

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(applyAnimePartial).toHaveBeenCalledWith(
      db,
      "anime-1",
      { estado: 1 },
      150,
    );
    expect(result.applied).toBe(1);
    expect(result.dropped).toBe(0);
    expect(result.deferred).toBe(0);
  });

  it("change_type create hace un insert completo vía upsertAnime y estampa el guard", async () => {
    const change = makeChange({ changeType: "create", snapshot: makeSnapshot(), timestamp: 100 });
    const ctx = makeContext();
    const db = {} as never;

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(upsertAnime).toHaveBeenCalledWith(db, change.snapshot, 100);
    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(result.applied).toBe(1);
  });

  it("update con changed_fields vacío deriva los campos diffeando contra la fila local", async () => {
    // The bridge sends empty changed_fields at runtime; the coordinator reads the local row
    // and applies only the fields that actually differ (here: estado), never the full snapshot.
    const currentRow = {
      _id: "anime-1",
      nombre: "Naruto",
      estado: 0,
      nrocapvisto: 12,
      totalcap: 220,
      dias: JSON.stringify([]),
      generos: JSON.stringify([]),
      tipo: 1,
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
      lastAppliedChangeMs: 100,
    };
    const limit = jest.fn().mockResolvedValue([currentRow]);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const db = { select: jest.fn().mockReturnValue({ from }) } as never;

    // snapshot keeps nrocapvisto at the local value (12) but flips estado to 1.
    const change = makeChange({
      changedFields: [],
      timestamp: 150,
      snapshot: makeSnapshot({ estado: 1, nrocapvisto: 12 }),
    });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(applyAnimePartial).toHaveBeenCalledWith(db, "anime-1", { estado: 1 }, 150);
    expect(upsertAnime).not.toHaveBeenCalled();
    expect(result.applied).toBe(1);
  });

  it("update con changed_fields vacío y fila inexistente hace cold insert vía upsertAnime", async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const db = { select: jest.fn().mockReturnValue({ from }) } as never;

    const change = makeChange({ changedFields: [], timestamp: 150, snapshot: makeSnapshot() });
    const ctx = makeContext();

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(upsertAnime).toHaveBeenCalledWith(db, change.snapshot, 150);
    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(result.applied).toBe(1);
  });

  it("change_type delete elimina la fila por _id", async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const del = jest.fn().mockReturnValue({ where });
    const db = { delete: del } as never;
    const change = makeChange({ changeType: "delete", snapshot: undefined });
    const ctx = makeContext();

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(del).toHaveBeenCalledWith(animes);
    expect(result.applied).toBe(1);
  });

  it("registro stale se descarta sin escribir nada (dropped)", async () => {
    const change = makeChange({ timestamp: 50 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });
    const db = {} as never;

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(upsertAnime).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
    expect(result.dropped).toBe(1);
    expect(result.deferred).toBe(0);
  });

  it("registro con op de outbox pendiente se difiere sin escribir nada (deferred)", async () => {
    const change = makeChange({ timestamp: 999 });
    const ctx = makeContext({ pendingOutboxRecordIds: new Set(["anime-1"]) });
    const db = {} as never;

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.deferred).toBe(1);
  });

  it("retorna conteos agregados para un batch mixto (apply + drop_stale + defer_outbox)", async () => {
    const changes = [
      makeChange({ recordId: "anime-1", timestamp: 200 }),
      makeChange({
        recordId: "anime-2",
        timestamp: 10,
      }),
      makeChange({ recordId: "anime-3", timestamp: 500 }),
    ];
    const ctx = makeContext({
      guardByRecordId: new Map([
        ["anime-1", 100],
        ["anime-2", 100],
      ]),
      pendingOutboxRecordIds: new Set(["anime-3"]),
    });
    const db = {} as never;

    const result = await applyRemoteChanges(db, changes, ctx);

    expect(result.applied).toBe(1);
    expect(result.dropped).toBe(1);
    expect(result.deferred).toBe(1);
  });

  it("update sin snapshot no escribe nada (defensive no-op)", async () => {
    const change = makeChange({ snapshot: undefined, timestamp: 999 });
    const ctx = makeContext();
    const db = {} as never;

    const result = await applyRemoteChanges(db, [change], ctx);

    expect(applyAnimePartial).not.toHaveBeenCalled();
    expect(upsertAnime).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
  });
});
