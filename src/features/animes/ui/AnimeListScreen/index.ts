import { createElement } from 'react';
import { AnimeListScreenView } from './AnimeListScreen';
import type { AnimeListScreenProps } from './anime-list-screen.types';
import { useAnimeListScreen } from './use-anime-list-screen';

export function AnimeListScreen(props: AnimeListScreenProps) {
  const viewModel = useAnimeListScreen(props);

  return createElement(AnimeListScreenView, viewModel);
}
