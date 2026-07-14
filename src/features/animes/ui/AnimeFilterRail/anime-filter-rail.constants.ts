import { ANIME_PSEUDO_DAY_FILTERS } from '../../anime.constants';
import type { AnimePseudoDayFilter } from '../../anime.types';

/** Provides fast membership checks for pseudo-day filters. */
export const PSEUDO_DAY_SET: ReadonlySet<AnimePseudoDayFilter> = new Set(ANIME_PSEUDO_DAY_FILTERS);
