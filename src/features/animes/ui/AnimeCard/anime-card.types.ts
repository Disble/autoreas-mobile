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
  /**
   * A local `file://` URI resolved by the future offline cover store.
   * `null` or `undefined` renders the placeholder cover, since no download
   * pipeline exists yet.
   */
  readonly coverUri?: string | null;
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

/** Defines the data contract for the anime card cover. */
export interface AnimeCardCoverProps {
  readonly coverUri: string | null | undefined;
}

/** Defines the data contract for the anime card season status block. */
export interface AnimeCardSeasonStatusProps {
  readonly status: AnimeSeasonStatusDescriptor;
}

/** Defines the data contract for the anime card info block (title, meta, season status). */
export interface AnimeCardInfoProps {
  readonly title: string;
  readonly metaLabel: string;
  readonly onToggleMeta: () => void;
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
}

/** Defines the data contract for the anime card state badge (ellipsis or state chip). */
export interface AnimeCardStateBadgeProps {
  readonly stateChip: AnimeStateChipDescriptor;
  readonly onPress: () => void;
}

/** Defines the data contract for the anime card actions row (season CTA and chapter controls). */
export interface AnimeCardActionsProps {
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly isMutationLocked: boolean;
  readonly nrocapvisto: number;
  readonly disableDecrease: boolean;
  readonly disableIncrease: boolean;
  readonly onOpenSeasonRatingSheet: () => void;
  readonly onReanudarPress: () => void;
  readonly onCapMinusPress: () => void;
  readonly onCapPlusPress: () => void;
  readonly onCapMinusLongPress: () => void;
  readonly onCapPlusLongPress: () => void;
}

/** Defines the data contract for the anime card decrease/count/increase chapter controls. */
export interface AnimeCardChapterControlsProps {
  readonly nrocapvisto: number;
  readonly disableDecrease: boolean;
  readonly disableIncrease: boolean;
  readonly onCapMinusPress: () => void;
  readonly onCapPlusPress: () => void;
  readonly onCapMinusLongPress: () => void;
  readonly onCapPlusLongPress: () => void;
}

/** Defines the data contract for the anime card right column (info, state badge, and actions). */
export interface AnimeCardContentProps {
  readonly title: string;
  readonly metaLabel: string;
  readonly onToggleMeta: () => void;
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly stateChip: AnimeStateChipDescriptor;
  readonly onStateBadgePress: () => void;
  readonly isMutationLocked: boolean;
  readonly nrocapvisto: number;
  readonly disableDecrease: boolean;
  readonly disableIncrease: boolean;
  readonly onOpenSeasonRatingSheet: () => void;
  readonly onCapMinusPress: () => void;
  readonly onCapPlusPress: () => void;
  readonly onCapMinusLongPress: () => void;
  readonly onCapPlusLongPress: () => void;
}
