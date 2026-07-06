import type { ActiveSeasonRatingSource, ActiveSeasonSnapshot } from "../../infrastructure/api";
import type { SeasonRatingQueueRow } from "../../infrastructure/db/schema";
import type {
  SeasonRatingFailureKind,
  SeasonRatingQueueStatus,
} from "../sync/season-rating-queue.types";
import type { Anime } from "../../infrastructure/validation/anime-schema";

export interface AnimeSeasonLocalIntent {
  readonly nota: number;
  readonly ratedAt: number;
  readonly createdAt: number;
  readonly status: SeasonRatingQueueStatus;
  readonly failureKind: SeasonRatingFailureKind | null;
}

export interface AnimeSeasonProjection {
  readonly seasonId: string;
  readonly bridgeRating: number | null;
  readonly bridgeRatingSource: ActiveSeasonRatingSource | null;
  readonly localIntent: AnimeSeasonLocalIntent | null;
}

export interface AnimeListItem extends Anime {
  readonly seasonProjection: AnimeSeasonProjection | null;
}

export interface BuildAnimeSeasonProjectionInput {
  readonly animeId: string;
  readonly allowLocalActiveFallback: boolean;
  readonly activeSeasonSnapshot: ActiveSeasonSnapshot | null;
  readonly seasonRatingQueueRows: readonly SeasonRatingQueueRow[];
}
