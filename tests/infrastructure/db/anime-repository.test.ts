import { eq } from "drizzle-orm";
import {
  applyAnimePartial,
  upsertAnime,
} from "../../../src/infrastructure/db/anime-repository";
import { animes } from "../../../src/infrastructure/db/schema";

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((column, value) => ({ column, value })),
}));

describe("applyAnimePartial", () => {
  it("escribe únicamente las columnas dadas más el guard, sin clobber del resto de la fila", async () => {
    const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const update = jest.fn().mockReturnValue({ set });
    const db = { update } as never;

    await applyAnimePartial(db, "anime-1", { estado: 1 }, 500);

    expect(update).toHaveBeenCalledWith(animes);
    expect(set).toHaveBeenCalledWith({ estado: 1, lastAppliedChangeMs: 500 });
  });

  it("filtra el update por _id usando eq", async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const db = { update } as never;

    await applyAnimePartial(db, "anime-1", { nrocapvisto: 5 }, 600);

    expect(where).toHaveBeenCalledWith({ column: animes._id, value: "anime-1" });
    expect(eq).toHaveBeenCalledWith(animes._id, "anime-1");
  });

  it("no escribe columnas que no fueron pasadas en partialColumns (no full-row clobber)", async () => {
    const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const update = jest.fn().mockReturnValue({ set });
    const db = { update } as never;

    await applyAnimePartial(db, "anime-1", { dias: "[]" }, 700);

    const setCallArg = set.mock.calls[0][0];
    expect(Object.keys(setCallArg)).toEqual(["dias", "lastAppliedChangeMs"]);
    expect(setCallArg).not.toHaveProperty("nombre");
    expect(setCallArg).not.toHaveProperty("estado");
  });

  it("partialColumns vacío aún estampa el guard column (advance-only no-op)", async () => {
    const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const update = jest.fn().mockReturnValue({ set });
    const db = { update } as never;

    await applyAnimePartial(db, "anime-1", {}, 800);

    expect(set).toHaveBeenCalledWith({ lastAppliedChangeMs: 800 });
  });
});

describe("upsertAnime", () => {
  it("persiste únicamente el modelo legacy normalizado en español", async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const db = { insert } as never;
    const normalizedAnime = {
      _id: "anime-1",
      nombre: "Naruto",
      estado: 1,
      nrocapvisto: 12,
      totalcap: 220,
      dias: [{ dia: "lunes", orden: 1 }],
      generos: ["accion"],
      tipo: 1,
      activo: 1,
      primeravez: 0,
      fechaUltCapVisto: 1710000000000,
      fechaEstreno: 1710000001000,
      fechaCreacion: 1710000002000,
      fechaEliminacion: null,
      portada: "cover.jpg",
      pagina: "https://example.com/anime-1",
      carpeta: "anime-1",
      estudios: "Pierrot",
      origen: "Manga",
      duracion: 24,
    };

    await upsertAnime(db, normalizedAnime);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      _id: "anime-1",
      nombre: "Naruto",
      estado: 1,
      nrocapvisto: 12,
      dias: JSON.stringify([{ dia: "lunes", orden: 1 }]),
      generos: JSON.stringify(["accion"]),
      pagina: "https://example.com/anime-1",
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ target: animes._id }));
  });
});
