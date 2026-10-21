import type { TextStyle, ViewStyle } from 'react-native';
import type { AnimatedStyle } from 'react-native-reanimated';
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
 * Identifies which part of the meta line a segment is, because the parts carry different type sizes.
 * `count` is drawn larger; `state` and `note` share the smaller detail size.
 */
export type AnimeCardMetaSegmentKind = 'count' | 'state' | 'note';

/**
 * One drawn piece of the meta line: its text and the kind that decides how it is styled.
 * The separator lives between segments, never inside one, so a list of segments can never render a
 * leading, trailing or doubled dot.
 */
export interface AnimeCardMetaSegment {
  readonly kind: AnimeCardMetaSegmentKind;
  readonly text: string;
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

/** Defines the data contract for the toggling meta line inside the info block. */
export interface AnimeCardMetaToggleProps {
  /** The segments to draw, in order; the view never reorders or filters them. */
  readonly segments: readonly AnimeCardMetaSegment[];
  /** The whole line as one string, exposed as the pressable's accessible label. */
  readonly label: string;
  /** The toggle's action, announced only when there are remaining episodes to switch to. */
  readonly hint?: string;
  readonly onPress: () => void;
  /** Lifts the line during the chapter-change bump. */
  readonly lineStyle?: AnimatedStyle<ViewStyle>;
  /** Turns the count accent during the chapter-change bump. */
  readonly countStyle?: AnimatedStyle<TextStyle>;
}

/** Defines the data contract for the anime card info block (title, meta line and long-episode mark). */
export interface AnimeCardInfoProps {
  readonly title: string;
  /** The ordered segments the meta line draws, each with its own kind and therefore its own size. */
  readonly metaSegments: readonly AnimeCardMetaSegment[];
  /** The whole composed meta line as one string, used as the pressable's accessible label. */
  readonly metaLabel: string;
  /** The meta toggle's accessibility hint; undefined when the toggle has nothing to switch to. */
  readonly metaToggleHint?: string;
  readonly onToggleMeta: () => void;
  /** "Ep. 7 · 45 min" when the next episode is long; `null` hides the mark. */
  readonly longEpisodeLabel: string | null;
  readonly lineStyle?: AnimatedStyle<ViewStyle>;
  readonly countStyle?: AnimatedStyle<TextStyle>;
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
  readonly plusStyle?: AnimatedStyle<ViewStyle>;
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly isMutationLocked: boolean;
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

/** Defines the data contract for the left group of the actions row: page, folder and note star. */
export interface AnimeCardShortcutsProps {
  /** Shows the page shortcut; only an http(s) url with a host has a page. */
  readonly hasPageLink: boolean;
  /** Shows the folder shortcut; only when the anime resolved to exactly one folder. */
  readonly hasFolder: boolean;
  /** Shows the note star; true only when `seasonStatus.showRatingCta` is. */
  readonly showNoteStar: boolean;
  readonly onOpenPage: () => void;
  readonly onOpenFolder: () => void;
  readonly onOpenSeasonRatingSheet: () => void;
}

/** Defines the data contract for the anime card decrease/increase chapter stepper. */
export interface AnimeCardChapterControlsProps {
  /** Pulses the plus button after a chapter is added. */
  readonly plusStyle?: AnimatedStyle<ViewStyle>;
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
  /** The chapter-change feedback styles, forwarded to the meta line and the plus button. */
  readonly feedback?: AnimeCardFeedbackStyles;
  readonly title: string;
  /** Forwarded untouched to `AnimeCardInfo`, which draws one span per segment. */
  readonly metaSegments: readonly AnimeCardMetaSegment[];
  readonly metaLabel: string;
  readonly metaToggleHint?: string;
  readonly onToggleMeta: () => void;
  readonly seasonStatus: AnimeSeasonStatusDescriptor | null;
  readonly longEpisodeLabel: string | null;
  readonly stateChip: AnimeStateChipDescriptor;
  readonly onStateBadgePress: () => void;
  readonly isMutationLocked: boolean;
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

/** Defines the chapter-change feedback styles the card hook draws. */
export interface AnimeCardFeedbackStyles {
  readonly countStyle: AnimatedStyle<TextStyle>;
  readonly lineStyle: AnimatedStyle<ViewStyle>;
  readonly plusStyle: AnimatedStyle<ViewStyle>;
}
