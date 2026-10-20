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
  /** Device path of the anime folder; `null` or `undefined` hides the folder shortcut. */
  readonly folderPath?: string | null;
}

/** Defines the visual tone for an anime state chip. */
export type AnimeStateChipTone = 'accent' | 'success' | 'warning' | 'danger';

/** Describes the state of a persisted anime as the card presents it. */
export interface AnimeStateChipDescriptor {
  readonly label: string;
  readonly tone: AnimeStateChipTone;
  readonly isDefault: boolean;
}

/** Defines the inputs that compose the single meta line under the card title. */
export interface AnimeCardMetaParams {
  readonly nrocapvisto: number;
  /** The persisted state label; it is always part of the line. */
  readonly stateLabel: string;
  /** The note segment, or `null` when the anime has no season candidacy to rate. */
  readonly noteLabel: string | null;
  /** The "X restantes" form; it replaces only the count segment while the toggle is on. */
  readonly restantesLabel?: string | null;
  readonly restantesShown?: boolean;
}

/**
 * Describes the season status presented on an anime card.
 * The card reads `label` for the note segment and `showRatingCta` to decide whether the season CTA
 * is drawn. Nothing else in the descriptor is rendered: the row that drew a description and a tone
 * was removed so the note appears once.
 */
export interface AnimeSeasonStatusDescriptor {
  readonly label: string;
  readonly showRatingCta: boolean;
}

/** Defines the data contract for the anime card cover. */
export interface AnimeCardCoverProps {
  readonly coverUri: string | null | undefined;
}

/** Defines the data contract for the anime card info block (title, meta line and long-episode mark). */
export interface AnimeCardInfoProps {
  readonly title: string;
  readonly metaLabel: string;
  readonly onToggleMeta: () => void;
  /** "Ep. 7 · 45 min" when the next episode is long; `null` hides the mark. */
  readonly longEpisodeLabel: string | null;
}

/** Defines the data contract for the anime card state affordance (the ellipsis). */
export interface AnimeCardStateBadgeProps {
  /** Carries the state label; the card no longer renders it as a coloured chip. */
  readonly stateChip: AnimeStateChipDescriptor;
  readonly onPress: () => void;
}

/**
 * Defines the data contract for the anime card actions row (season CTA and chapter controls).
 * `seasonStatus` is read only for `showRatingCta`.
 */
export interface AnimeCardActionsProps {
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly isMutationLocked: boolean;
  readonly nrocapvisto: number;
  readonly disableDecrease: boolean;
  readonly disableIncrease: boolean;
  readonly onOpenSeasonRatingSheet: () => void;
  /** Shows the page shortcut; only an http(s) url with a host has a page. */
  readonly hasPageLink: boolean;
  /** Shows the folder shortcut; only when the anime resolved to exactly one folder. */
  readonly hasFolder: boolean;
  readonly onOpenPage: () => void;
  readonly onOpenFolder: () => void;
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

/**
 * Defines the data contract for the anime card right column (info, state badge, and actions).
 * `seasonStatus` goes only to the actions row, which reads `showRatingCta`.
 */
export interface AnimeCardContentProps {
  readonly title: string;
  readonly metaLabel: string;
  readonly onToggleMeta: () => void;
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly longEpisodeLabel: string | null;
  readonly stateChip: AnimeStateChipDescriptor;
  readonly onStateBadgePress: () => void;
  readonly isMutationLocked: boolean;
  readonly nrocapvisto: number;
  readonly disableDecrease: boolean;
  readonly disableIncrease: boolean;
  readonly onOpenSeasonRatingSheet: () => void;
  /** Shows the page shortcut; only an http(s) url with a host has a page. */
  readonly hasPageLink: boolean;
  /** Shows the folder shortcut; only when the anime resolved to exactly one folder. */
  readonly hasFolder: boolean;
  readonly onOpenPage: () => void;
  readonly onOpenFolder: () => void;
  readonly onCapMinusPress: () => void;
  readonly onCapPlusPress: () => void;
  readonly onCapMinusLongPress: () => void;
  readonly onCapPlusLongPress: () => void;
}
