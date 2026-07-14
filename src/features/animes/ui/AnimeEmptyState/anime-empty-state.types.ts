import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { AnimeDayFilter } from '../../anime.types';

/** Defines the data contract for anime empty state props. */
export interface AnimeEmptyStateProps {
  readonly filter: AnimeDayFilter;
}

/** Defines the data contract for anime empty state view props. */
export interface AnimeEmptyStateViewProps {
  readonly hint: string;
  readonly icon: ComponentProps<typeof Ionicons>['name'];
  readonly message: string;
}
