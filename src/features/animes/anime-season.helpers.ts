import type {
  AnimeSeasonLocalIntent,
  AnimeSeasonProjection,
  BuildAnimeSeasonProjectionInput,
} from "./anime-season.types";
import type { SeasonRatingIntent } from "../sync/season-rating-event.types";

/**
 * Picks the latest durable season-rating intent for one anime within one season.
 * This keeps UI projection aligned with the newest local intent without leaking stale rows from older seasons.
 */
export function selectLatestSeasonRatingIntent(
  animeId: string,
  seasonId: string,
  seasonRatingIntents: readonly SeasonRatingIntent[],
): AnimeSeasonLocalIntent | null {
  const matchingRows = seasonRatingIntents.filter(
    (row) => row.animeId === animeId && row.seasonId === seasonId,
  );

  if (matchingRows.length === 0) {
    return null;
  }

  matchingRows.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }

    return right.id - left.id;
  });

  const latestRow = matchingRows[0];

  return {
    nota: latestRow.nota,
    ratedAt: latestRow.ratedAt,
    createdAt: latestRow.createdAt,
    status: latestRow.status,
    failureKind: latestRow.failureKind,
  };
}

/**
 * Builds the season projection consumed by anime list and card surfaces from the anime's own
 * candidacy (`anime.season`, carried on the anime sync path). Only a candidate of the open season
 * has one, so offline mode never invents rating eligibility: a local intent counts only for the
 * season the anime is a candidate of.
 */
export function buildAnimeSeasonProjection(
  input: BuildAnimeSeasonProjectionInput,
): AnimeSeasonProjection | null {
  const { animeId, season, seasonRatingIntents } = input;

  if (!season) {
    return null;
  }

  return {
    seasonId: season.seasonId,
    bridgeRating: season.grade,
    localIntent: selectLatestSeasonRatingIntent(animeId, season.seasonId, seasonRatingIntents),
  };
}
