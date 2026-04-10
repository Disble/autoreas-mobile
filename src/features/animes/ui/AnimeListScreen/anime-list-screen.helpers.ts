import type { Anime } from "../../../../infrastructure/validation/anime-schema";
import {
  ANIME_DAY_FILTER_OPTIONS,
  WEEKDAY_INDEX_TO_FILTER,
} from "../../anime.constants";
import { matchesAnimeDayFilter } from "../../anime.helpers";
import type { AnimeDayFilter } from "../../anime.types";
import type {
  AnimeListScreenContextualHeader,
  AnimeListScreenFilterCounts,
} from "./anime-list-screen.types";

/**
 * Counts how many active animes belong to each day filter based on their `dias` tags.
 * This powers the filter rail badges so users can see at a glance where the backlog lives.
 */
export function computeFilterCounts(
  animes: readonly Anime[],
): AnimeListScreenFilterCounts {
  const counts = {} as Record<AnimeDayFilter, number>;

  for (const option of ANIME_DAY_FILTER_OPTIONS) {
    counts[option.value] = 0;
  }

  for (const anime of animes) {
    for (const option of ANIME_DAY_FILTER_OPTIONS) {
      if (matchesAnimeDayFilter(anime, option.value)) {
        counts[option.value] += 1;
      }
    }
  }

  return counts;
}

const PSEUDO_DAY_TITLE: Readonly<Record<string, string>> = {
  "Ver hoy": "Para ver hoy",
  "Sin ver": "Sin ver",
  Visto: "Vistos",
};

/**
 * Builds the contextual header shown above the anime list based on the active filter and count.
 * Centralizing title/subtitle copy here keeps the view dumb and makes empty/singular/plural states testable.
 */
export function buildContextualHeader(
  filter: AnimeDayFilter,
  count: number,
  now: Date,
): AnimeListScreenContextualHeader {
  const todayWeekday = WEEKDAY_INDEX_TO_FILTER[now.getDay()];
  const isToday = filter === todayWeekday;
  const title = PSEUDO_DAY_TITLE[filter] ?? filter;

  let subtitle: string;
  if (count === 0) {
    subtitle = "Sin animes para este filtro";
  } else if (count === 1) {
    subtitle = "1 anime para ver";
  } else {
    subtitle = `${count} animes para ver`;
  }

  return {
    title,
    subtitle,
    isToday,
  };
}
