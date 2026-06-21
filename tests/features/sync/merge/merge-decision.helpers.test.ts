import { decideMerge } from "../../../../src/features/sync/merge/merge-decision.helpers";
import type {
  MergeContext,
  RemoteAnimeChange,
} from "../../../../src/features/sync/merge/merge.types";

function makeChange(overrides: Partial<RemoteAnimeChange> = {}): RemoteAnimeChange {
  return {
    recordId: "anime-1",
    changeType: "update",
    changedFields: ["estado"],
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

describe("decideMerge", () => {
  it("change_type delete siempre decide 'delete', sin importar el guard ni el outbox", () => {
    const change = makeChange({ changeType: "delete", timestamp: 50 });
    const ctx = makeContext({
      guardByRecordId: new Map([["anime-1", 999]]),
      pendingOutboxRecordIds: new Set(["anime-1"]),
    });

    expect(decideMerge(change, ctx)).toBe("delete");
  });

  it("ordering: delete > outbox > stale > apply -- un registro con op pendiente difiere incluso si es 'newer'", () => {
    const change = makeChange({ timestamp: 200 });
    const ctx = makeContext({
      guardByRecordId: new Map([["anime-1", 100]]),
      pendingOutboxRecordIds: new Set(["anime-1"]),
    });

    expect(decideMerge(change, ctx)).toBe("defer_outbox");
  });

  it("guard NULL (o ausente) siempre aplica (never stale)", () => {
    const change = makeChange({ timestamp: 1 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", null]]) });

    expect(decideMerge(change, ctx)).toBe("apply");
  });

  it("registro sin entrada en el guard map (nunca visto) también aplica", () => {
    const change = makeChange({ timestamp: 1 });
    const ctx = makeContext();

    expect(decideMerge(change, ctx)).toBe("apply");
  });

  it("timestamp igual al guard se descarta (empate favorece al local)", () => {
    const change = makeChange({ timestamp: 100 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });

    expect(decideMerge(change, ctx)).toBe("drop_stale");
  });

  it("timestamp menor al guard se descarta (snapshot congelado)", () => {
    const change = makeChange({ timestamp: 50 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });

    expect(decideMerge(change, ctx)).toBe("drop_stale");
  });

  it("timestamp mayor al guard y sin outbox pendiente aplica", () => {
    const change = makeChange({ timestamp: 150 });
    const ctx = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });

    expect(decideMerge(change, ctx)).toBe("apply");
  });

  it("la protección de outbox está acotada por record_id (otro anime no se ve afectado)", () => {
    const changeForY = makeChange({ recordId: "anime-Y", timestamp: 150 });
    const ctx = makeContext({
      guardByRecordId: new Map([["anime-Y", 100]]),
      pendingOutboxRecordIds: new Set(["anime-X"]),
    });

    expect(decideMerge(changeForY, ctx)).toBe("apply");
  });

  it("re-entrega idéntica (mismo change, mismo timestamp ya aplicado) es idempotente -> drop_stale", () => {
    const change = makeChange({ timestamp: 100 });
    const ctxAfterFirstApply = makeContext({ guardByRecordId: new Map([["anime-1", 100]]) });

    expect(decideMerge(change, ctxAfterFirstApply)).toBe("drop_stale");
  });
});
