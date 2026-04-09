import { createElement } from 'react';
import type { AnimeDayFilter, AnimeDayFilterOption } from '../../anime.types';
import { AnimeCard } from '../AnimeCard';
import type { RawAnimeDayFilterOption } from './anime-list-screen.types';
import type { AnimeListScreenViewProps } from './anime-list-screen.types';

/**
 * Normalizes a Select value emitted by HeroUI Native into a single option.
 * This keeps the screen hook resilient if the component ever returns arrays or undefined values.
 */
export function resolveSelectedAnimeDayFilterOption(
  value:
    | RawAnimeDayFilterOption
    | readonly RawAnimeDayFilterOption[]
    | undefined
): AnimeDayFilterOption | null {
  if (!value) {
    return null;
  }

  const selectedValue = Array.isArray(value) ? value[0] ?? null : value;

  if (!selectedValue) {
    return null;
  }

  return {
    label: selectedValue.label,
    value: selectedValue.value as AnimeDayFilter,
  };
}

/**
 * Renders a single anime row using the screen view-model callbacks.
 * Keeping this renderer outside the `.tsx` file satisfies the strict colocation rule without duplicating card wiring.
 */
export function renderAnimeListItem(
  item: AnimeListScreenViewProps['animes'][number],
  isMutatingAnimeById: AnimeListScreenViewProps['isMutatingAnimeById'],
  handleCapMinus: AnimeListScreenViewProps['handleCapMinus'],
  handleCapPlus: AnimeListScreenViewProps['handleCapPlus']
) {
  return createElement(AnimeCard, {
    anime: item,
    isMutating: !!isMutatingAnimeById[item._id],
    onCapMinus: () => {
      void handleCapMinus(item._id);
    },
    onCapPlus: () => {
      void handleCapPlus(item._id);
    },
  });
}
