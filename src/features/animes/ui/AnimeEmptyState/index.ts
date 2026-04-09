import { createElement } from 'react';
import { AnimeEmptyStateView } from './AnimeEmptyState';
import type { AnimeEmptyStateProps } from './anime-empty-state.types';
import { useAnimeEmptyState } from './use-anime-empty-state';

export function AnimeEmptyState(props: AnimeEmptyStateProps) {
  const viewModel = useAnimeEmptyState(props);

  return createElement(AnimeEmptyStateView, viewModel);
}
