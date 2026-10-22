import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ViewStyle } from 'react-native';
import type { Href } from 'expo-router';
import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type { ChapterActionContext } from '../../chapter-action-diagnostics.types';
import type {
  SyncVisibleStatus,
  SyncVisibleStatusFacts,
} from '../../../sync/sync-visible-status.types';
import type { AnimeListItem } from '../../anime-season.types';
import type { SeasonRatingValue } from '../SeasonRatingSheet';
import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';

/** Defines the anime list screen props value shape. */
export type AnimeListScreenProps = Record<never, never>;

/** Defines the anime list screen filter counts value shape. */
export type AnimeListScreenFilterCounts = Readonly<Record<AnimeDayFilter, number>>;

/** Defines the data contract for anime list screen contextual header. */
export interface AnimeListScreenContextualHeader {
  readonly title: string;
  readonly subtitle: string;
  readonly isToday: boolean;
}

/** Defines the data contract for anime state sheet request. */
export interface AnimeStateSheetRequest {
  readonly animeId: string;
  readonly currentEstado: number;
  /** Shown under the sheet title, so the user sees which anime the state applies to. */
  readonly animeTitle: string;
}

/**
 * Defines the data contract for season rating sheet request.
 * It carries the note only: per-note sync status is deliberately absent, because sync health is
 * reported once by the sync button in the bar and its sheet, exactly as for any other anime mutation.
 */
export interface SeasonRatingSheetRequest {
  readonly animeId: string;
  /** The season the anime is a candidate of; the rating is queued for exactly this season. */
  readonly seasonId: string;
  readonly animeTitle: string;
  readonly bridgeRating: number | null;
  readonly pendingRating: number | null;
}

/**
 * Defines the bar's fixed side columns and the room left for the title, so the sync button never
 * covers the title however long it is.
 */
export interface AnimeListScreenHeaderLayout {
  readonly sideColumnStyle: Readonly<ViewStyle>;
  readonly titleStyle: Readonly<{ maxWidth: number }>;
}

/** Defines the data contract for anime list screen header left props. */
export interface AnimeListScreenHeaderLeftProps {
  readonly handleOpenSettings: () => void;
  readonly sideColumnStyle: Readonly<ViewStyle>;
  readonly themeColorForeground: string;
}

/** Defines the data contract for anime list screen header right props. */
export interface AnimeListScreenHeaderRightProps {
  readonly refreshAccessibilityLabel: string;
  readonly isRefreshing: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly sideColumnStyle: Readonly<ViewStyle>;
  readonly syncStatus: AnimeListScreenVisibleSyncStatus;
  readonly themeColorForeground: string;
  readonly handleOpenSyncSheet: () => void;
  readonly handleRefreshPress: () => void;
}

/** Defines the data contract for the anime list screen header title props. */
export interface AnimeListScreenHeaderTitleProps {
  readonly title: string;
  readonly style: Readonly<{ maxWidth: number }>;
}

/** Defines the anime list screen sync facts value shape. */
export type AnimeListScreenSyncFacts = SyncVisibleStatusFacts;

/** Defines the data contract for anime list screen manual sync availability facts. */
export interface AnimeListScreenManualSyncAvailabilityFacts
  extends AnimeListScreenSyncFacts {
  readonly isRefreshing: boolean;
}

/** Defines the data contract for anime list screen visible sync status. */
export interface AnimeListScreenVisibleSyncStatus extends SyncVisibleStatus {
  readonly actionLabel: string | null;
}

/** Defines the data contract for anime list screen refresh feedback. */
export interface AnimeListScreenRefreshFeedback {
  readonly description: string;
  readonly label: string;
}

/** Defines the options the anime list screen's failure toasts are shown with. */
export interface AnimeListScreenFailureToastOptions {
  readonly variant: 'danger' | 'warning';
  readonly label: string;
  readonly description: string;
  readonly duration: number;
}

/**
 * The minimal toast surface the anime list screen's failure paths call.
 *
 * Structural rather than imported from the UI library: the callback helpers stay unit-testable
 * with a plain spy, and this narrow options type keeps the toast's full option surface out of the
 * screen's contract.
 */
export interface AnimeListScreenFailureToast {
  readonly show: (options: AnimeListScreenFailureToastOptions) => unknown;
}

/** The chapter command the list screen hands to the shared same-anime lock runner. */
export type AnimeListScreenChapterActionRunner = (
  animeId: string,
  actionContext: ChapterActionContext,
) => Promise<void>;

/** Defines the collaborators the chapter mutation runner resolves per call. */
export interface AnimeListScreenChapterMutationDeps {
  readonly isTelemetryEnabled: boolean;
  readonly mutatingAnimeByIdRef: MutableRefObject<Record<string, boolean>>;
  readonly setIsMutatingAnimeById: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly toast: AnimeListScreenFailureToast;
}

/** Defines the collaborators one manual refresh of the list resolves per call. */
export interface AnimeListScreenManualRefreshDeps {
  readonly manualSync: () => Promise<unknown>;
  readonly setIsRefreshing: (isRefreshing: boolean) => void;
  readonly syncFacts: AnimeListScreenSyncFacts;
  readonly toast: AnimeListScreenFailureToast;
}

/** Defines the data contract produced by the anime list screen behavior hook. */
export interface AnimeListScreenViewModel {
  readonly animes: AnimeListItem[];
  readonly filterOptions: readonly AnimeDayFilterOption[];
  readonly filterCounts: AnimeListScreenFilterCounts;
  readonly contextualHeader: AnimeListScreenContextualHeader;
  readonly layoutMode: LayoutMode;
  readonly headerLayout: AnimeListScreenHeaderLayout;
  readonly isMutatingAnimeById: Readonly<Record<string, boolean>>;
  readonly isDark: boolean;
  readonly isEmpty: boolean;
  readonly isRefreshing: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly isSeasonMode: boolean;
  readonly isSyncSheetOpen: boolean;
  readonly refreshAccessibilityLabel: string;
  readonly syncStatus: AnimeListScreenVisibleSyncStatus;
  readonly selectedFilter: AnimeDayFilter;
  readonly selectedFilterOption: AnimeDayFilterOption;
  readonly settingsHref: Href;
  readonly stateSheetRequest: AnimeStateSheetRequest | null;
  readonly seasonRatingSheetRequest: SeasonRatingSheetRequest | null;
  readonly themeColorForeground: string;
  readonly today: AnimeDayFilter;
  readonly handleCapMinus: (animeId: string) => Promise<void>;
  readonly handleCapMinusHalf: (animeId: string) => Promise<void>;
  readonly handleCapPlus: (animeId: string) => Promise<void>;
  readonly handleCapPlusHalf: (animeId: string) => Promise<void>;
  readonly handleCloseStateSheet: () => void;
  readonly handleOpenSettings: () => void;
  readonly handleCloseSeasonRatingSheet: () => void;
  readonly handleCloseSyncSheet: () => void;
  readonly handleOpenSyncSheet: () => void;
  readonly handleOpenSeasonRatingSheet: (animeId: string) => void;
  readonly handleOpenStateSheet: (animeId: string, currentEstado: number) => void;
  readonly handleRefresh: () => Promise<void>;
  readonly handleRefreshPress: () => void;
  readonly handleSelectedFilterChange: (filter: AnimeDayFilter) => void;
  readonly handleSeasonRatingSubmit: (rating: SeasonRatingValue) => Promise<void>;
  readonly handleStateSheetSelect: (estado: number) => Promise<void>;
}

/**
 * Defines the data contract for one list row: its anime, its own lock and folder, and the screen-level
 * handlers that take an anime id. Every member keeps its identity unless that row's data changed, so a
 * write or a tap re-renders only the rows it touched.
 */
export interface AnimeListScreenItemProps {
  readonly anime: AnimeListItem;
  readonly isMutating: boolean;
  readonly folderPath: string | null;
  readonly handleCapMinus: (animeId: string) => Promise<void>;
  readonly handleCapMinusHalf: (animeId: string) => Promise<void>;
  readonly handleCapPlus: (animeId: string) => Promise<void>;
  readonly handleCapPlusHalf: (animeId: string) => Promise<void>;
  readonly handleOpenSeasonRatingSheet: (animeId: string) => void;
  readonly handleOpenStateSheet: (animeId: string, currentEstado: number) => void;
}

/** Defines the complete render model consumed by the dumb anime list screen view. */
export interface AnimeListScreenRenderModel extends AnimeListScreenViewModel {
  readonly getAnimeListItemProps: (item: AnimeListItem) => AnimeListScreenItemProps;
}

/** Defines the stable prop boundary for the dumb anime list screen view. */
export interface AnimeListScreenViewProps {
  readonly model: AnimeListScreenRenderModel;
}

/** Defines the data contract for the responsive filter rail section. */
export type AnimeListScreenFilterSectionProps = Pick<
  AnimeListScreenViewModel,
  | 'filterOptions'
  | 'filterCounts'
  | 'selectedFilter'
  | 'today'
  | 'layoutMode'
  | 'handleSelectedFilterChange'
>;

/** Defines the data contract for the list head: sync alert, contextual subtitle and folder banner. */
export type AnimeListScreenListHeadProps = Pick<
  AnimeListScreenViewModel,
  'contextualHeader' | 'isSeasonMode' | 'syncStatus' | 'handleOpenSettings'
>;

/** Defines the data contract for the list column: its head and the scrolling list. */
export type AnimeListScreenListColumnProps = AnimeListScreenListHeadProps &
  AnimeListScreenContentProps;

/** Defines the data contract for the anime list content section. */
export type AnimeListScreenContentProps = Pick<
  AnimeListScreenRenderModel,
  | 'animes'
  | 'isEmpty'
  | 'isManualSyncEnabled'
  | 'isRefreshing'
  | 'layoutMode'
  | 'selectedFilter'
  | 'getAnimeListItemProps'
  | 'handleRefresh'
>;

/** Defines the data contract for anime list modal sheets. */
export type AnimeListScreenSheetsProps = Pick<
  AnimeListScreenViewModel,
  | 'stateSheetRequest'
  | 'seasonRatingSheetRequest'
  | 'isManualSyncEnabled'
  | 'isSyncSheetOpen'
  | 'syncStatus'
  | 'handleCloseSeasonRatingSheet'
  | 'handleCloseStateSheet'
  | 'handleCloseSyncSheet'
  | 'handleOpenSettings'
  | 'handleRefresh'
  | 'handleSeasonRatingSubmit'
  | 'handleStateSheetSelect'
>;
