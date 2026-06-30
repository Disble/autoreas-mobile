import type { ReactElement } from "react";
import { createElement } from "react";
import type { Anime } from "../../../../infrastructure/validation/anime-schema";
import {
  ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL,
  ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL,
} from "./anime-list-screen.constants";
import {
  ANIME_DAY_FILTER_OPTIONS,
  WEEKDAY_INDEX_TO_FILTER,
} from "../../anime.constants";
import { matchesAnimeDayFilter } from "../../anime.helpers";
import type { AnimeDayFilter } from "../../anime.types";
import { AnimeListScreenHeaderLeft } from "./AnimeListScreenHeaderLeft";
import { AnimeListScreenHeaderRight } from "./AnimeListScreenHeaderRight";
import {
  deriveVisibleSyncStatus as deriveSharedVisibleSyncStatus,
  isManualSyncAvailableNow,
} from '../../../sync/sync-visible-status.helpers';
import type {
  AnimeListScreenContextualHeader,
  AnimeListScreenFilterCounts,
  AnimeListScreenHeaderLeftProps,
  AnimeListScreenHeaderRightProps,
  AnimeListScreenManualSyncAvailabilityFacts,
  AnimeListScreenRefreshFeedback,
  AnimeListScreenSyncFacts,
  AnimeListScreenVisibleSyncStatus,
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
    if (anime.estado === 0) {
      continue;
    }

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

const SHORT_WEEKDAY_BY_INDEX: readonly string[] = [
  "Dom",
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
];

const SHORT_MONTH_BY_INDEX: readonly string[] = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/**
 * Formats the given date as a compact Spanish label like "Jue 9 abr".
 * Purpose-built for the contextual header badge: short, scannable, locale-safe without Intl.
 */
export function formatTodayLabel(date: Date): string {
  const weekday = SHORT_WEEKDAY_BY_INDEX[date.getDay()];
  const day = date.getDate();
  const month = SHORT_MONTH_BY_INDEX[date.getMonth()];
  return `${weekday} ${day} ${month}`;
}

function buildCountSubtitle(count: number): string {
  if (count === 1) {
    return "1 anime para ver";
  }
  return `${count} animes para ver`;
}

function buildEmptySubtitle(filter: AnimeDayFilter, isToday: boolean): string {
  if (filter === "Ver hoy") {
    return "Al día. Nada pendiente para hoy.";
  }
  if (filter === "Sin ver") {
    return "Todo empezado. Bien ahí.";
  }
  if (filter === "Visto") {
    return "Todavía no archivaste ningún anime.";
  }
  if (isToday) {
    return "Al día. Nada pendiente para hoy.";
  }
  return `Sin pendientes para ${filter}`;
}

/**
 * Derives the sync banner shown inside AnimeListScreen from runtime sync facts.
 * The screen stays dumb while product copy, escalation thresholds, and tone decisions live in one pure helper.
 */
export function deriveVisibleSyncStatus(
  facts: AnimeListScreenSyncFacts,
  now: Date,
): AnimeListScreenVisibleSyncStatus {
  const status = deriveSharedVisibleSyncStatus(facts, now);
  const actionLabel =
    facts.pendingOpsCount === 0
      ? null
      : facts.isBridgeConfigured === false
        ? ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL
        : facts.isDeviceOnline === false
          ? null
          : ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL;

  return {
    ...status,
    actionLabel,
  };
}

/**
 * Builds the warning toast copy shown when a manual refresh fails from the anime list.
 * The message stays aligned with the shared visible-status model so phone-offline and bridge issues do not blur together.
 */
export function buildRefreshFailureFeedback(
  facts: AnimeListScreenSyncFacts,
): AnimeListScreenRefreshFeedback {
  if (facts.isDeviceOnline === false) {
    return {
      label: 'Este teléfono está sin internet.',
      description:
        'Tu catálogo local sigue disponible y el sync se va a reintentar cuando vuelva la conexión.',
    };
  }

  return {
    label: 'No se pudo sincronizar con el bridge.',
    description: 'Tus cambios siguen guardados en este dispositivo.',
  };
}

/**
 * Derives whether the AnimeListScreen manual refresh affordances should stay enabled.
 * The screen uses one gate for header button and pull-to-refresh so both reflect the same sync availability facts.
 */
export function deriveManualSyncEnabled(
  facts: AnimeListScreenManualSyncAvailabilityFacts,
): boolean {
  if (facts.isRefreshing) {
    return false;
  }

  return isManualSyncAvailableNow(facts);
}

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
  const isToday = filter === todayWeekday || filter === "Ver hoy";
  const title = PSEUDO_DAY_TITLE[filter] ?? filter;

  let subtitle: string;
  if (count === 0) {
    subtitle = buildEmptySubtitle(filter, isToday);
  } else if (isToday) {
    subtitle = `${buildCountSubtitle(count).replace(" para ver", "")} · ${formatTodayLabel(now)}`;
  } else {
    subtitle = buildCountSubtitle(count);
  }

  return {
    title,
    subtitle,
    isToday,
  };
}

/**
 * Builds the stable Stack header-left renderer outside the screen component.
 * This avoids redefining JSX-producing functions on every AnimeListScreen render.
 */
export function buildHeaderLeftRenderer(
  props: AnimeListScreenHeaderLeftProps,
): () => ReactElement {
  return function renderHeaderLeft() {
    return createElement(AnimeListScreenHeaderLeft, props);
  };
}

/**
 * Builds the stable Stack header-right renderer outside the screen component.
 * Keeping the renderer factory in helpers satisfies Sonar without moving UI logic back into the screen.
 */
export function buildHeaderRightRenderer(
  props: AnimeListScreenHeaderRightProps,
): () => ReactElement {
  return function renderHeaderRight() {
    return createElement(AnimeListScreenHeaderRight, props);
  };
}
