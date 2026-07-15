import { createElement } from 'react';
import { AnimeEmptyStateView } from './AnimeEmptyState';
import type { AnimeEmptyStateProps } from './anime-empty-state.types';
import { useAnimeEmptyState } from './use-anime-empty-state';

/** Composes anime empty-state behavior with its presentational view. */
export function AnimeEmptyState(props: Readonly<AnimeEmptyStateProps>) {
  const viewModel = useAnimeEmptyState(props);
  return createElement(AnimeEmptyStateView, viewModel);
}
