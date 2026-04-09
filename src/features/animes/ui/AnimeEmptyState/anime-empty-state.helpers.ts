import {
  DEFAULT_WEEKDAY_ICON,
  PSEUDO_DAY_EMPTY_STATE_HINT,
  PSEUDO_DAY_ICONS,
  PSEUDO_DAY_MESSAGES,
  WEEKDAY_EMPTY_STATE_HINT,
} from './anime-empty-state.constants';
import type { AnimeEmptyStateViewProps } from './anime-empty-state.types';
import type { AnimeDayFilter } from '../../anime.types';

/**
 * Builds empty-state copy for the active legacy day filter.
 * This keeps day/pseudo-day messaging consistent between the hook and the dumb UI component.
 */
export function buildAnimeEmptyState(filter: AnimeDayFilter): AnimeEmptyStateViewProps {
  if (filter in PSEUDO_DAY_MESSAGES) {
    const pseudoDayFilter = filter as keyof typeof PSEUDO_DAY_MESSAGES;

    return {
      icon: PSEUDO_DAY_ICONS[pseudoDayFilter],
      message: PSEUDO_DAY_MESSAGES[pseudoDayFilter],
      hint: PSEUDO_DAY_EMPTY_STATE_HINT,
    };
  }

  return {
    icon: DEFAULT_WEEKDAY_ICON,
    message: `No hay animes para ${filter}.`,
    hint: WEEKDAY_EMPTY_STATE_HINT,
  };
}
