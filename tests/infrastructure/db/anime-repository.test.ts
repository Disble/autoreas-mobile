import { eq } from "drizzle-orm";
import { applyAnimePartial } from "../../../src/infrastructure/db/anime-repository";
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
