import { useCallback } from "react";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime";
import {
  applyAnimeMutationPatch,
  buildCapMinusHalfPatch,
  buildCapMinusPatch,
  buildCapPlusHalfPatch,
  buildCapPlusPatch,
  buildSetEstadoPatch,
} from "./anime-mutation.helpers";

/** Coordinates mutate anime state and actions. */
export function useMutateAnime() {
  const rawDb = useOptionalSQLiteContext();

  const capPlus = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }
      await applyAnimeMutationPatch(rawDb, animeId, buildCapPlusPatch, "capPlus");
    },
    [rawDb],
  );

  const capMinus = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }
      await applyAnimeMutationPatch(rawDb, animeId, buildCapMinusPatch, "capMinus");
    },
    [rawDb],
  );

  const capPlusHalf = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }
      await applyAnimeMutationPatch(rawDb, animeId, buildCapPlusHalfPatch, "capPlusHalf");
    },
    [rawDb],
  );

  const capMinusHalf = useCallback(
    async (animeId: string): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }
      await applyAnimeMutationPatch(rawDb, animeId, buildCapMinusHalfPatch, "capMinusHalf");
    },
    [rawDb],
  );

  const setEstado = useCallback(
    async (animeId: string, estado: number): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }
      await applyAnimeMutationPatch(
        rawDb,
        animeId,
        (anime, now) => buildSetEstadoPatch(anime, estado, now),
        "setEstado",
      );
    },
    [rawDb],
  );

  return { capPlus, capMinus, capPlusHalf, capMinusHalf, setEstado };
}
