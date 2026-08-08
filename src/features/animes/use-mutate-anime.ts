import { useCallback } from "react";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import {
  applyAnimeMutationPatch,
  buildCapMinusHalfPatch,
  buildCapMinusPatch,
  buildCapPlusHalfPatch,
  buildCapPlusPatch,
  buildSetEstadoPatch,
  recordAnimeMutationFailure,
} from "./anime-mutation.helpers";
import type { AnimeMutationPatchBuilder } from "./anime-mutation.types";

/** Coordinates mutate anime state and actions. */
export function useMutateAnime() {
  const rawDb = useOptionalSQLiteContext();

  // Every chapter action funnels through here so a failed write is always recorded before it
  // propagates. The error is rethrown untouched: callers still decide how to surface it, but it
  // can no longer disappear silently the way it did when each action awaited the patch directly.
  const runTrackedMutation = useCallback(
    async (
      animeId: string,
      buildPatch: AnimeMutationPatchBuilder,
      label: string,
    ): Promise<void> => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      try {
        await applyAnimeMutationPatch(rawDb, animeId, buildPatch, label);
      } catch (error) {
        await recordAnimeMutationFailure(rawDb, label, error);
        throw error;
      }
    },
    [rawDb],
  );

  const capPlus = useCallback(
    async (animeId: string): Promise<void> =>
      runTrackedMutation(animeId, buildCapPlusPatch, "capPlus"),
    [runTrackedMutation],
  );

  const capMinus = useCallback(
    async (animeId: string): Promise<void> =>
      runTrackedMutation(animeId, buildCapMinusPatch, "capMinus"),
    [runTrackedMutation],
  );

  const capPlusHalf = useCallback(
    async (animeId: string): Promise<void> =>
      runTrackedMutation(animeId, buildCapPlusHalfPatch, "capPlusHalf"),
    [runTrackedMutation],
  );

  const capMinusHalf = useCallback(
    async (animeId: string): Promise<void> =>
      runTrackedMutation(animeId, buildCapMinusHalfPatch, "capMinusHalf"),
    [runTrackedMutation],
  );

  const setEstado = useCallback(
    async (animeId: string, estado: number): Promise<void> =>
      runTrackedMutation(
        animeId,
        (anime, now) => buildSetEstadoPatch(anime, estado, now),
        "setEstado",
      ),
    [runTrackedMutation],
  );

  return { capPlus, capMinus, capPlusHalf, capMinusHalf, setEstado };
}
