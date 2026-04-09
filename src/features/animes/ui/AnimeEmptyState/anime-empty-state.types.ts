import type { AnimeDayFilter } from '../../anime.types';

export interface AnimeEmptyStateProps {
  readonly filter: AnimeDayFilter;
}

export interface AnimeEmptyStateViewProps {
  readonly hint: string;
  readonly icon: string;
  readonly message: string;
}
