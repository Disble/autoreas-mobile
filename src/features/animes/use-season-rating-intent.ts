import { useCallback } from "react";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import { enqueueSeasonRatingIntent } from "../sync/season-rating-intent.helpers";
import type { SeasonRatingTarget } from "./anime-season.types";
import type { SeasonRatingValue } from "./ui/SeasonRatingSheet";

/** Coordinates season rating intent state and actions. */
export function useSeasonRatingIntent() {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  // The rating is queued for the season the rated anime is a candidate of: the caller passes
  // the anime's own projection, so there is no season to look up and none to guess.
  const submitSeasonRatingIntent = useCallback(
    async ({ animeId, seasonId }: SeasonRatingTarget, rating: SeasonRatingValue) => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      await enqueueSeasonRatingIntent(rawDb, {
        seasonId,
        animeId,
        nota: rating,
        ratedAt: Date.now(),
      });
    },
    [rawDb],
  );

  // 7. Effects

  return {
    submitSeasonRatingIntent,
  };
}
