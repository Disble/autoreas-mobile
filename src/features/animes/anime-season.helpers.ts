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
  const seasonIdSet = new Set(seasonIds);
  const matchingRows = seasonRatingQueueRows.filter(
    (row) => row.animeId === animeId && seasonIdSet.has(row.seasonId),
  );

  if (matchingRows.length === 0) {
    return null;
  }

  matchingRows.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }

    return (right.id ?? 0) - (left.id ?? 0);
  });

  const latestRow = matchingRows[0];

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
 * Projection exists for bridge-declared candidates or a durable local rating intent.
 * This prevents offline mode from inventing rating eligibility for every visible anime.
 */
export function buildAnimeSeasonProjection(
  input: BuildAnimeSeasonProjectionInput,
): AnimeSeasonProjection | null {
  const {
    activeSeasonSnapshot,
    animeId,
    seasonRatingQueueRows,
  } = input;
  const candidate = activeSeasonSnapshot?.candidatesByAnimeId[animeId] ?? null;
  const seasonId = activeSeasonSnapshot?.seasonId ?? LOCAL_ACTIVE_SEASON_ID;
  const localIntent = selectLatestSeasonRatingIntent(
    animeId,
    buildSeasonIntentLookupIds(seasonId),
    seasonRatingQueueRows,
  );

  if (!candidate) {
    if (!localIntent) {
      return null;
    }

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
