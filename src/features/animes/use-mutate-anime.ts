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
import {
  recordChapterActionFailed,
  recordChapterActionSkipped,
} from "./chapter-action-diagnostics.helpers";
import type { ChapterActionContext } from "./chapter-action-diagnostics.types";

/** Coordinates mutate anime state and actions. */
export function useMutateAnime() {
  const rawDb = useOptionalSQLiteContext();

  // Every chapter action funnels through here so a failed write is always recorded before it
  // propagates. The error is rethrown untouched: callers still decide how to surface it, but it
  // can no longer disappear silently the way it did when each action awaited the patch directly.
  //
  // `actionContext` is optional and additive: the list screen opens one when an enabled chapter
  // button fires, and the estado flow passes none.
  const runTrackedMutation = useCallback(
    async (
      animeId: string,
      buildPatch: AnimeMutationPatchBuilder,
      label: string,
      actionContext?: ChapterActionContext,
    ): Promise<void> => {
      if (!rawDb) {
        // Recorded here, while the context is still in scope, because this guard sits OUTSIDE the
        // try below: nothing else in this function ever sees this path. Reported as a skip and not
        // as a finished/failed write, because no write was attempted or rejected -- the database
        // was never there -- and forwarding `finished` would claim knowledge this layer does not
        // have. `recordAnimeMutationFailure` cannot be used here for the same reason: it needs a
        // non-null db, which is exactly what is missing.
        if (actionContext) {
          recordChapterActionSkipped(actionContext, 'db_unavailable');
        }

        throw getExpoSQLiteUnavailableError();
      }

      try {
        const didMutate = await applyAnimeMutationPatch(
          rawDb,
          animeId,
          buildPatch,
          label,
          actionContext,
        );

        // The helper resolves normally when the row is absent. Reporting that as a skip is what
        // keeps "nothing was there to change" from being read as a write that landed.
        if (!didMutate && actionContext) {
          recordChapterActionSkipped(actionContext, "anime_missing");
        }
      } catch (error) {
        // Recorded at this layer rather than inside the helper because this is the layer that owns
        // the action's promise: every write failure the helper lets escape is observed exactly
        // once here, before the error is rethrown. The missing-SQLite-context case is deliberately
        // NOT part of this guarantee -- it is handled by the guard above, which runs before the
        // try and never reaches this block.
        if (actionContext) {
          recordChapterActionFailed(actionContext, error);
        }

        await recordAnimeMutationFailure(rawDb, label, error);
        throw error;
      }
    },
    [rawDb],
  );

  const capPlus = useCallback(
    async (animeId: string, actionContext?: ChapterActionContext): Promise<void> =>
      runTrackedMutation(animeId, buildCapPlusPatch, "capPlus", actionContext),
    [runTrackedMutation],
  );

  const capMinus = useCallback(
    async (animeId: string, actionContext?: ChapterActionContext): Promise<void> =>
      runTrackedMutation(animeId, buildCapMinusPatch, "capMinus", actionContext),
    [runTrackedMutation],
  );

  const capPlusHalf = useCallback(
    async (animeId: string, actionContext?: ChapterActionContext): Promise<void> =>
      runTrackedMutation(animeId, buildCapPlusHalfPatch, "capPlusHalf", actionContext),
    [runTrackedMutation],
  );

  const capMinusHalf = useCallback(
    async (animeId: string, actionContext?: ChapterActionContext): Promise<void> =>
      runTrackedMutation(animeId, buildCapMinusHalfPatch, "capMinusHalf", actionContext),
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
