import {
  buildPartialUpdate,
  deriveChangedFields,
  isStale,
} from "../../../../src/features/sync/merge/field-merge.helpers";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

function makeSnapshot(overrides: Partial<Anime> = {}): Anime {
  return {
    _id: "anime-1",
    nombre: "Naruto",
    estado: 2,
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
  };
}

describe("buildPartialUpdate", () => {
  it("aplica solo los campos listados en changed_fields y preserva los no listados (AC1/AC2)", () => {
    const snapshot = makeSnapshot({ estado: 1, nrocapvisto: 0 });

    const result = buildPartialUpdate(["estado"], snapshot);

    expect(result.columns).toEqual({ estado: 1 });
    expect(result.columns).not.toHaveProperty("nrocapvisto");
    expect(result.skippedFields).toEqual([]);
  });

  it("changed_fields vacío no modifica ninguna columna", () => {
    const snapshot = makeSnapshot();

    const result = buildPartialUpdate([], snapshot);

    expect(result.columns).toEqual({});
    expect(result.skippedFields).toEqual([]);
  });

  it("un campo desconocido se omite (logueado) sin afectar el resto de campos conocidos", () => {
    const snapshot = makeSnapshot({ estado: 3 });

    const result = buildPartialUpdate(["estado", "campoInexistente"], snapshot);

    expect(result.columns).toEqual({ estado: 3 });
    expect(result.skippedFields).toEqual(["campoInexistente"]);
  });

  it("serializa dias y generos como JSON string al construir el partial update", () => {
    const snapshot = makeSnapshot({
      dias: [{ dia: "lunes", orden: 1 }],
      generos: ["accion", "aventura"],
    });

    const result = buildPartialUpdate(["dias", "generos"], snapshot);

    expect(result.columns).toEqual({
      dias: JSON.stringify([{ dia: "lunes", orden: 1 }]),
      generos: JSON.stringify(["accion", "aventura"]),
    });
  });

  it("una actualización solo de estado no incluye nrocapvisto (AC2 - no full snapshot clobber)", () => {
    const snapshot = makeSnapshot({ estado: 0, nrocapvisto: 12 });

    const result = buildPartialUpdate(["estado"], snapshot);

    expect(Object.keys(result.columns)).toEqual(["estado"]);
  });
});

describe("deriveChangedFields", () => {
  // The bridge watcher detects legacy changes by hash and never populates changed_fields at
  // runtime, so mobile derives the changed set by diffing the snapshot against the local row.
  it("devuelve solo los campos cuyo valor del snapshot difiere de la fila local", () => {
    const snapshot = makeSnapshot({ estado: 1, nrocapvisto: 5 });
    const currentRow = {
      _id: "anime-1",
      nombre: "Naruto",
      estado: 0,
      nrocapvisto: 5,
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
      lastAppliedChangeMs: null,
    };

    expect(deriveChangedFields(snapshot, currentRow)).toEqual(["estado"]);
  });

  it("devuelve [] cuando el snapshot es idéntico a la fila local (no-op)", () => {
    const snapshot = makeSnapshot({ estado: 2, nrocapvisto: 0, dias: [], generos: [] });
    const currentRow = {
      _id: "anime-1",
      nombre: "Naruto",
      estado: 2,
      nrocapvisto: 0,
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
      lastAppliedChangeMs: 123,
    };

    expect(deriveChangedFields(snapshot, currentRow)).toEqual([]);
  });

  it("detecta diferencias en dias/generos comparando su forma serializada JSON", () => {
    const snapshot = makeSnapshot({ dias: [{ dia: "lunes", orden: 1 }], generos: ["accion"] });
    const currentRow = {
      _id: "anime-1",
      nombre: "Naruto",
      estado: 2,
      nrocapvisto: 0,
      totalcap: 220,
      dias: JSON.stringify([]),
      generos: JSON.stringify(["accion"]),
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
      lastAppliedChangeMs: null,
    };

    expect(deriveChangedFields(snapshot, currentRow)).toEqual(["dias"]);
  });
});

describe("isStale", () => {
  it("guard NULL nunca es stale (primer apply siempre pasa)", () => {
    expect(isStale(100, null)).toBe(false);
  });

  it("changeMs mayor que el guard no es stale", () => {
    expect(isStale(200, 100)).toBe(false);
  });

  it("changeMs igual al guard SI es stale (empate favorece al local, no-op)", () => {
    expect(isStale(100, 100)).toBe(true);
  });

  it("changeMs menor al guard es stale (snapshot congelado se descarta)", () => {
    expect(isStale(50, 100)).toBe(true);
  });
});
