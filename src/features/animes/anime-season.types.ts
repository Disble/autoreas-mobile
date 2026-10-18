import type {
  SeasonRatingFailureKind,
  SeasonRatingIntent,
  SeasonRatingIntentStatus,
} from "../sync/season-rating-event.types";
import type { Anime, AnimeSeason } from "../../infrastructure/validation/anime-schema";

/** Defines the data contract for anime season local intent. */
export interface AnimeSeasonLocalIntent {
  readonly nota: number;
  readonly ratedAt: number;
  readonly createdAt: number;
  readonly status: SeasonRatingIntentStatus;
  readonly failureKind: SeasonRatingFailureKind | null;
}

/** Defines the data contract for anime season projection. */
export interface AnimeSeasonProjection {
  readonly seasonId: string;
  readonly bridgeRating: number | null;
  readonly localIntent: AnimeSeasonLocalIntent | null;
}

/**
 * The anime a season rating is for and the season it is a candidate of, taken from the anime's
 * own projection so a rating can only be made for an anime that has one.
 */
export interface SeasonRatingTarget {
  readonly animeId: string;
  readonly seasonId: string;
}

/** Defines the data contract for anime list item. */
export interface AnimeListItem extends Anime {
  readonly seasonProjection: AnimeSeasonProjection | null;
}

/** Defines the data contract for build anime season projection input. */
export interface BuildAnimeSeasonProjectionInput {
  readonly animeId: string;
  /** The anime's candidacy of the open season; absent or `null` when it is not a candidate. */
  readonly season: AnimeSeason | null | undefined;
  readonly seasonRatingIntents: readonly SeasonRatingIntent[];
}
