import { useCallback } from "react";
import {
  getExpoSQLiteUnavailableError,
  useOptionalSQLiteContext,
} from "../../infrastructure/db/native-runtime";
import { useActiveSeasonStore } from "../../infrastructure/store/active-season-store";
import { LOCAL_ACTIVE_SEASON_ID } from "./anime-season.constants";
import { enqueueSeasonRatingIntent } from "../sync/season-rating-queue.helpers";
import type { SeasonRatingValue } from "./ui/SeasonRatingSheet/season-rating-sheet.types";

export function useSeasonRatingIntent() {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const activeSeasonSnapshot = useActiveSeasonStore(
    (state) => state.activeSeasonSnapshot,
  );

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)

  // 6. Callbacks (useCallback calling pure helpers)
  const submitSeasonRatingIntent = useCallback(
    async (animeId: string, rating: SeasonRatingValue) => {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      await enqueueSeasonRatingIntent(rawDb, {
        seasonId: activeSeasonSnapshot?.seasonId ?? LOCAL_ACTIVE_SEASON_ID,
        animeId,
        nota: rating,
        ratedAt: Date.now(),
      });
    },
    [activeSeasonSnapshot, rawDb],
  );

  // 7. Effects

  return {
    submitSeasonRatingIntent,
  };
}
