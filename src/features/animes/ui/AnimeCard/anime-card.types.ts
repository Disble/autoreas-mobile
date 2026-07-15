import type { Anime } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeSeasonProjection } from '../../anime-season.types';

/** Defines the data contract for anime card props. */
export interface AnimeCardProps {
  readonly anime: Anime & {
    readonly seasonProjection?: AnimeSeasonProjection | null;
  };
  readonly isMutating: boolean;
  readonly onCapPlus: () => void;
  readonly onCapMinus: () => void;
  readonly onCapPlusHalf?: () => void;
  readonly onCapMinusHalf?: () => void;
  readonly onOpenStateSheet?: (animeId: string, currentEstado: number) => void;
  readonly onOpenSeasonRatingSheet?: (animeId: string) => void;
}

/** Defines the visual tone for an anime state chip. */
export type AnimeStateChipTone = 'accent' | 'success' | 'warning' | 'danger';

/** Describes the state chip rendered for a persisted anime state. */
export interface AnimeStateChipDescriptor {
  readonly label: string;
  readonly tone: AnimeStateChipTone;
  readonly isDefault: boolean;
}

/** Defines the visual tone for an anime season status. */
export type AnimeSeasonStatusTone = 'accent' | 'warning';

/** Describes the season status presented on an anime card. */
export interface AnimeSeasonStatusDescriptor {
  readonly label: string;
  readonly description: string;
  readonly tone: AnimeSeasonStatusTone;
  readonly showRatingCta: boolean;
}
