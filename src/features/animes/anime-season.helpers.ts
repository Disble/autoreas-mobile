import type {
  AnimeSeasonLocalIntent,
  AnimeSeasonProjection,
  BuildAnimeSeasonProjectionInput,
} from "./anime-season.types";
import type {
  SeasonRatingFailureKind,
  SeasonRatingQueueStatus,
} from "../sync/season-rating-queue.types";
import type { SeasonRatingQueueRow } from "../../infrastructure/db/schema";
import { LOCAL_ACTIVE_SEASON_ID } from "./anime-season.constants";

function buildSeasonIntentLookupIds(seasonId: string): readonly string[] {
  if (seasonId === LOCAL_ACTIVE_SEASON_ID) {
    return [seasonId];
  }

  return [seasonId, LOCAL_ACTIVE_SEASON_ID];
}

/**
 * Picks the latest durable season-rating intent for one anime within the active season.
 * This keeps UI projection aligned with the newest local intent without leaking stale rows from older seasons.
 */
export function selectLatestSeasonRatingIntent(
  animeId: string,
  seasonIds: readonly string[],
  seasonRatingQueueRows: readonly SeasonRatingQueueRow[],
): AnimeSeasonLocalIntent | null {
  const matchingRows = seasonRatingQueueRows.filter(
    (row) => row.animeId === animeId && seasonIds.includes(row.seasonId),
  );

  if (matchingRows.length === 0) {
    return null;
  }

  const latestRow = matchingRows.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }

    return (right.id ?? 0) - (left.id ?? 0);
  })[0];

  return {
    nota: latestRow.nota,
    ratedAt: latestRow.ratedAt,
    createdAt: latestRow.createdAt,
    status: latestRow.status as SeasonRatingQueueStatus,
    failureKind: latestRow.lastFailureKind as SeasonRatingFailureKind | null,
  };
}

/**
 * Builds the season projection consumed by anime list and card surfaces.
 * Projection exists only for bridge-declared active candidates, which prevents mobile-owned candidacy inference.
 */
export function buildAnimeSeasonProjection(
  input: BuildAnimeSeasonProjectionInput,
): AnimeSeasonProjection | null {
  const {
    activeSeasonSnapshot,
    allowLocalActiveFallback,
    animeId,
    seasonRatingQueueRows,
  } = input;
  const candidate = activeSeasonSnapshot?.candidatesByAnimeId[animeId] ?? null;

  if (!candidate && !allowLocalActiveFallback) {
    return null;
  }

  const seasonId = activeSeasonSnapshot?.seasonId ?? LOCAL_ACTIVE_SEASON_ID;
  const localIntent = selectLatestSeasonRatingIntent(
    animeId,
    buildSeasonIntentLookupIds(seasonId),
    seasonRatingQueueRows,
  );

  if (!candidate) {
    return {
      seasonId,
      bridgeRating: null,
      bridgeRatingSource: null,
      localIntent,
    };
  }

  return {
    seasonId,
    bridgeRating: candidate.bridgeRating,
    bridgeRatingSource: candidate.bridgeRatingSource,
    localIntent,
  };
}
