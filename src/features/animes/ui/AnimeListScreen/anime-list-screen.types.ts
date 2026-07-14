import type { Href } from 'expo-router';
import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type {
  SyncVisibleStatus,
  SyncVisibleStatusFacts,
  SyncVisibleStatusTone,
} from '../../../sync/sync-visible-status.types';
import type { AnimeListItem } from '../../anime-season.types';
import type { SeasonRatingFailureKind } from '../../../sync/season-rating-queue.types';
import type { SeasonRatingValue } from '../SeasonRatingSheet';
import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';
import type { AnimeCardProps } from '../AnimeCard';

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
}

/** Defines the data contract for season rating sheet request. */
export interface SeasonRatingSheetRequest {
  readonly animeId: string;
  readonly animeTitle: string;
  readonly bridgeRating: number | null;
  readonly pendingRating: number | null;
  readonly pendingStatus: 'pending' | 'failed' | null;
  readonly pendingFailureKind: SeasonRatingFailureKind | null;
}

/** Defines the data contract for anime list screen header left props. */
export interface AnimeListScreenHeaderLeftProps {
  readonly handleOpenSettings: () => void;
  readonly themeColorForeground: string;
}

/** Defines the data contract for anime list screen header right props. */
export interface AnimeListScreenHeaderRightProps {
  readonly refreshAccessibilityLabel: string;
  readonly isRefreshing: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly themeColorForeground: string;
  readonly handleRefresh: () => Promise<void>;
}

/** Defines the anime list screen sync tone value shape. */
export type AnimeListScreenSyncTone = SyncVisibleStatusTone;

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

/** Defines the data contract produced by the anime list screen behavior hook. */
export interface AnimeListScreenViewModel {
  readonly animes: AnimeListItem[];
  readonly filterOptions: readonly AnimeDayFilterOption[];
  readonly filterCounts: AnimeListScreenFilterCounts;
  readonly contextualHeader: AnimeListScreenContextualHeader;
  readonly layoutMode: LayoutMode;
  readonly isMutatingAnimeById: Readonly<Record<string, boolean>>;
  readonly isDark: boolean;
  readonly isEmpty: boolean;
  readonly isRefreshing: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly isSeasonMode: boolean;
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
  readonly handleOpenSeasonRatingSheet: (animeId: string) => void;
  readonly handleOpenStateSheet: (animeId: string, currentEstado: number) => void;
  readonly handleRefresh: () => Promise<void>;
  readonly handleSelectedFilterChange: (filter: AnimeDayFilter) => void;
  readonly handleSeasonRatingSubmit: (rating: SeasonRatingValue) => Promise<void>;
  readonly handleStateSheetSelect: (estado: number) => Promise<void>;
}

/** Defines the complete render model consumed by the dumb anime list screen view. */
export interface AnimeListScreenRenderModel extends AnimeListScreenViewModel {
  readonly getAnimeCardProps: (item: AnimeListItem) => AnimeCardProps;
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

/** Defines the data contract for the contextual status section. */
export type AnimeListScreenStatusSectionProps = Pick<
  AnimeListScreenViewModel,
  'contextualHeader' | 'isSeasonMode' | 'syncStatus' | 'handleOpenSettings'
>;

/** Defines the data contract for the anime list content section. */
export type AnimeListScreenContentProps = Pick<
  AnimeListScreenRenderModel,
  | 'animes'
  | 'isEmpty'
  | 'isManualSyncEnabled'
  | 'isMutatingAnimeById'
  | 'isRefreshing'
  | 'layoutMode'
  | 'selectedFilter'
  | 'getAnimeCardProps'
  | 'handleRefresh'
>;

/** Defines the data contract for anime list modal sheets. */
export type AnimeListScreenSheetsProps = Pick<
  AnimeListScreenViewModel,
  | 'stateSheetRequest'
  | 'seasonRatingSheetRequest'
  | 'handleCloseSeasonRatingSheet'
  | 'handleCloseStateSheet'
  | 'handleSeasonRatingSubmit'
  | 'handleStateSheetSelect'
>;
