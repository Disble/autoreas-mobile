import { createElement } from 'react';
import { AnimeListScreenView } from './AnimeListScreen';
import type { AnimeListScreenProps } from './anime-list-screen.types';
import { useAnimeListItemRenderer } from './use-anime-list-item-renderer';
import { useAnimeListScreen } from './use-anime-list-screen';

/** Composes anime-list behavior with its presentational screen. */
export function AnimeListScreen(props: Readonly<AnimeListScreenProps>) {
  const viewModel = useAnimeListScreen(props);
  const { getAnimeCardProps } = useAnimeListItemRenderer(
    viewModel.isMutatingAnimeById,
    viewModel.handleCapMinus,
    viewModel.handleCapPlus,
    viewModel.handleCapPlusHalf,
    viewModel.handleCapMinusHalf,
    viewModel.handleOpenSeasonRatingSheet,
    viewModel.handleOpenStateSheet,
  );

  return createElement(AnimeListScreenView, {
    model: {
      ...viewModel,
      getAnimeCardProps,
    },
  });
}
