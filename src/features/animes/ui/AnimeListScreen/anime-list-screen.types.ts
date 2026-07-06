import type { Href } from 'expo-router';
import type { LayoutMode } from '../../../../hooks/use-responsive-layout';
import type {
  SyncVisibleStatus,
  SyncVisibleStatusFacts,
  SyncVisibleStatusTone,
} from '../../../sync/sync-visible-status.types';
import type { AnimeListItem } from '../../anime-season.types';
import type { SeasonRatingFailureKind } from '../../../sync/season-rating-queue.types';
import type { SeasonRatingValue } from '../SeasonRatingSheet/season-rating-sheet.types';
import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';

export type AnimeListScreenProps = Record<never, never>;

export type AnimeListScreenFilterCounts = Readonly<Record<AnimeDayFilter, number>>;

export interface AnimeListScreenContextualHeader {
  readonly title: string;
  readonly subtitle: string;
  readonly isToday: boolean;
}

export interface AnimeStateSheetRequest {
  readonly animeId: string;
  readonly currentEstado: number;
}

export interface SeasonRatingSheetRequest {
  readonly animeId: string;
  readonly animeTitle: string;
  readonly bridgeRating: number | null;
  readonly pendingRating: number | null;
  readonly pendingStatus: 'pending' | 'failed' | null;
  readonly pendingFailureKind: SeasonRatingFailureKind | null;
}

export interface AnimeListScreenHeaderLeftProps {
  readonly handleOpenSettings: () => void;
  readonly themeColorForeground: string;
}

export interface AnimeListScreenHeaderRightProps {
  readonly refreshAccessibilityLabel: string;
  readonly isRefreshing: boolean;
  readonly isManualSyncEnabled: boolean;
  readonly themeColorForeground: string;
  readonly handleRefresh: () => Promise<void>;
}

export type AnimeListScreenSyncTone = SyncVisibleStatusTone;

export type AnimeListScreenSyncFacts = SyncVisibleStatusFacts;

export interface AnimeListScreenManualSyncAvailabilityFacts
  extends AnimeListScreenSyncFacts {
  readonly isRefreshing: boolean;
}

export interface AnimeListScreenVisibleSyncStatus extends SyncVisibleStatus {
  readonly actionLabel: string | null;
}

export interface AnimeListScreenRefreshFeedback {
  readonly description: string;
  readonly label: string;
}

export interface AnimeListScreenViewProps {
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

export type AnimeListScreenViewModel = AnimeListScreenViewProps;
