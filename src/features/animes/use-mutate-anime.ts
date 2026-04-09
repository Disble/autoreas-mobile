import { eq } from "drizzle-orm";
import {
  createDrizzleDb,
  withExclusiveWrite,
} from "../../infrastructure/db/client";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime";
import { animes, operationLog } from "../../infrastructure/db/schema";
import {
  AnimePatchSchema,
  AnimeSchema,
} from "../../infrastructure/validation/anime-schema";
import { syncPendingOperations } from "../sync/use-reconcile";

export function useMutateAnime() {
  const rawDb = useOptionalSQLiteContext();

  const capPlus = async (animeId: string): Promise<void> => {
    if (!rawDb) {
      throw getExpoSQLiteUnavailableError();
    }

    const db = createDrizzleDb(rawDb);
    const [row] = await db
      .select()
      .from(animes)
      .where(eq(animes._id, animeId))
      .limit(1);
    if (!row) return;

    // dias y generos vienen de SQLite como JSON strings — deserializar antes de parsear con Zod
    const anime = AnimeSchema.parse({
      ...row,
      dias:
        typeof row.dias === "string" ? JSON.parse(row.dias) : (row.dias ?? []),
      generos:
        typeof row.generos === "string"
          ? JSON.parse(row.generos)
          : (row.generos ?? []),
    });
    const now = Date.now();
    const newCap = anime.nrocapvisto + 1;

    const isFirstTime = anime.primeravez === 1;
    const isFinished =
      anime.totalcap != null && anime.totalcap > 0 && newCap === anime.totalcap;

    const patch = {
      nrocapvisto: newCap,
      ...(isFinished ? { estado: 1 } : {}),
    };
    const bridgePatch = AnimePatchSchema.parse(patch);

    await withExclusiveWrite(rawDb, async (txDb) => {
      await txDb
        .update(animes)
        .set({
          nrocapvisto: bridgePatch.nrocapvisto,
          fechaUltCapVisto: now,
          ...(isFirstTime ? { fechaEstreno: now, primeravez: 0 } : {}),
          ...(isFinished ? { estado: 1 } : {}),
        })
        .where(eq(animes._id, anime._id));

      await txDb.insert(operationLog).values({
        animeId: anime._id,
        operation: "cap_plus",
        payload: JSON.stringify({ nrocapvisto: bridgePatch.nrocapvisto }),
        status: "pending",
        createdAt: now,
      });

      if (isFinished) {
        await txDb.insert(operationLog).values({
          animeId: anime._id,
          operation: "estado_change",
          payload: JSON.stringify({ estado: 1 }),
          status: "pending",
          createdAt: now,
        });
      }
    });

    // Sincroniza en background — no bloquea la UI
    void syncPendingOperations(rawDb).catch((err) => {
      console.warn("[capPlus] Sync failed:", err);
    });
  };;

  const capMinus = async (animeId: string): Promise<void> => {
    if (!rawDb) {
      throw getExpoSQLiteUnavailableError();
    }

    const db = createDrizzleDb(rawDb);
    const [row] = await db
      .select()
      .from(animes)
      .where(eq(animes._id, animeId))
      .limit(1);
    if (!row) return;

    // dias y generos vienen de SQLite como JSON strings — deserializar antes de parsear con Zod
    const anime = AnimeSchema.parse({
      ...row,
      dias:
        typeof row.dias === "string" ? JSON.parse(row.dias) : (row.dias ?? []),
      generos:
        typeof row.generos === "string"
          ? JSON.parse(row.generos)
          : (row.generos ?? []),
    });
    const now = Date.now();
    const patch = AnimePatchSchema.parse({
      nrocapvisto: Math.max(0, anime.nrocapvisto - 1),
    });

    await withExclusiveWrite(rawDb, async (txDb) => {
      await txDb
        .update(animes)
        .set({
          nrocapvisto: patch.nrocapvisto,
          fechaUltCapVisto: now,
        })
        .where(eq(animes._id, anime._id));

      await txDb.insert(operationLog).values({
        animeId: anime._id,
        operation: "cap_minus",
        payload: JSON.stringify(patch),
        status: "pending",
        createdAt: now,
      });
    });

    // Sincroniza en background — no bloquea la UI
    void syncPendingOperations(rawDb).catch((err) => {
      console.warn("[capMinus] Sync failed:", err);
    });
  };;

  return { capPlus, capMinus };
}
