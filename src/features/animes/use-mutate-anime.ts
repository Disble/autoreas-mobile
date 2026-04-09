import { eq } from "drizzle-orm";
import { useCallback } from "react";
import {
  withExclusiveWrite,
} from "../../infrastructure/db/client";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime";
import { animes, operationLog } from "../../infrastructure/db/schema";
import {
  buildCapMinusPatch,
  buildCapPlusPatch,
  fetchParsedAnime,
  serializeMutationOperation,
  toLocalAnimeUpdate,
} from "./anime-mutation.helpers";
import { syncPendingOperations } from "../sync/use-reconcile";

export function useMutateAnime() {
  const rawDb = useOptionalSQLiteContext();

  const capPlus = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      const now = Date.now();
      let didMutate = false;

      await withExclusiveWrite(rawDb, async (txDb, tx) => {
        const anime = await fetchParsedAnime(tx, animeId);
        if (!anime) return;

        const bridgePatch = buildCapPlusPatch(anime, now);
        const operation = serializeMutationOperation(bridgePatch);

        await txDb
          .update(animes)
          .set(toLocalAnimeUpdate(bridgePatch))
          .where(eq(animes._id, anime._id));

        await txDb.insert(operationLog).values({
          animeId: anime._id,
          operation: operation.operation,
          payload: operation.payload,
          status: "pending",
          createdAt: now,
        });

        didMutate = true;
      });

      if (!didMutate) return;

      // Sincroniza en background — no bloquea la UI
      void syncPendingOperations(rawDb).catch((err) => {
        console.warn("[capPlus] Sync failed:", err);
      });
    },
    [rawDb],
  );

  const capMinus = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      const now = Date.now();
      let didMutate = false;

      await withExclusiveWrite(rawDb, async (txDb, tx) => {
        const anime = await fetchParsedAnime(tx, animeId);
        if (!anime) return;

        const bridgePatch = buildCapMinusPatch(anime, now);
        const operation = serializeMutationOperation(bridgePatch);

        await txDb
          .update(animes)
          .set(toLocalAnimeUpdate(bridgePatch))
          .where(eq(animes._id, anime._id));

        await txDb.insert(operationLog).values({
          animeId: anime._id,
          operation: operation.operation,
          payload: operation.payload,
          status: "pending",
          createdAt: now,
        });

        didMutate = true;
      });

      if (!didMutate) return;

      // Sincroniza en background — no bloquea la UI
      void syncPendingOperations(rawDb).catch((err) => {
        console.warn("[capMinus] Sync failed:", err);
      });
    },
    [rawDb],
  );

  return { capPlus, capMinus };
}
