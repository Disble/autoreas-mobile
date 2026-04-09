import type { Href } from 'expo-router';
import type { Anime } from '../../../../infrastructure/validation/anime-schema';
import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';

export type AnimeListScreenProps = Record<never, never>;

export interface RawAnimeDayFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface AnimeListScreenViewProps {
  readonly animes: Anime[];
  readonly filterOptions: readonly AnimeDayFilterOption[];
  readonly isMutatingAnimeById: Readonly<Record<string, boolean>>;
  readonly isDark: boolean;
  readonly isEmpty: boolean;
  readonly isRefreshing: boolean;
  readonly refreshAccessibilityLabel: string;
  readonly selectedFilter: AnimeDayFilter;
  readonly selectedFilterOption: AnimeDayFilterOption;
  readonly selectListLabel: string;
  readonly selectPlaceholder: string;
  readonly settingsHref: Href;
  readonly themeColorForeground: string;
  readonly handleCapMinus: (animeId: string) => Promise<void>;
  readonly handleCapPlus: (animeId: string) => Promise<void>;
  readonly handleOpenSettings: () => void;
  readonly handleRefresh: () => Promise<void>;
  readonly handleSelectedFilterChange: (
    value:
      | RawAnimeDayFilterOption
      | readonly RawAnimeDayFilterOption[]
      | undefined
  ) => void;
}

export type AnimeListScreenViewModel = AnimeListScreenViewProps;
