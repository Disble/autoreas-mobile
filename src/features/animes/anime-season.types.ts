import type { ActiveSeasonRatingSource, ActiveSeasonSnapshot } from "../../infrastructure/api";
import type {
  SeasonRatingFailureKind,
  SeasonRatingIntent,
  SeasonRatingIntentStatus,
} from "../sync/season-rating-event.types";
import type { Anime } from "../../infrastructure/validation/anime-schema";

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
  readonly bridgeRatingSource: ActiveSeasonRatingSource | null;
  readonly localIntent: AnimeSeasonLocalIntent | null;
}

/** Defines the data contract for anime list item. */
export interface AnimeListItem extends Anime {
  readonly seasonProjection: AnimeSeasonProjection | null;
}

/** Defines the data contract for build anime season projection input. */
export interface BuildAnimeSeasonProjectionInput {
  readonly animeId: string;
  readonly activeSeasonSnapshot: ActiveSeasonSnapshot | null;
  readonly seasonRatingIntents: readonly SeasonRatingIntent[];
}
