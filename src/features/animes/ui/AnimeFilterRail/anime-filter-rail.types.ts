import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';

export type AnimeFilterRailOrientation = 'horizontal' | 'vertical';

export interface AnimeFilterRailItem {
  readonly value: AnimeDayFilter;
  readonly label: string;
  readonly count: number;
  readonly isToday: boolean;
  readonly isSelected: boolean;
}

export interface AnimeFilterRailProps {
  readonly options: readonly AnimeDayFilterOption[];
  readonly counts: Readonly<Record<string, number>>;
  readonly selected: AnimeDayFilter;
  readonly today: AnimeDayFilter;
  readonly orientation: AnimeFilterRailOrientation;
  readonly onSelect: (value: AnimeDayFilter) => void;
}

export interface BuildAnimeFilterRailItemsInput {
  readonly options: readonly AnimeDayFilterOption[];
  readonly counts: Readonly<Record<string, number>>;
  readonly selected: AnimeDayFilter;
  readonly today: AnimeDayFilter;
}
