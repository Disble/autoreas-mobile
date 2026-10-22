import type { ReactElement } from "react";
import { createElement } from "react";
import type { ListRenderItemInfo, RefreshControlProps } from "react-native";
import { RefreshControl, View } from "react-native";
import type { Anime } from "../../../../infrastructure/validation/anime-schema";
import type { LayoutMode } from "../../../../hooks/responsive-layout.types";
import {
  ANIME_LIST_SCREEN_HEADER_EDGE_INSET,
  ANIME_LIST_SCREEN_HEADER_SIDE_WIDTH,
  ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL,
  ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL,
  PSEUDO_DAY_TITLE,
  SHORT_MONTH_BY_INDEX,
  SHORT_WEEKDAY_BY_INDEX,
} from "./anime-list-screen.constants";
import {
  ANIME_DAY_FILTER_OPTIONS,
  WEEKDAY_INDEX_TO_FILTER,
} from "../../anime.constants";
import { matchesAnimeDayFilter } from "../../anime.helpers";
import type { AnimeDayFilter } from "../../anime.types";
import type { AnimeListItem } from "../../anime-season.types";
import { AnimeCard } from "../AnimeCard/AnimeCard";
import type { AnimeCardProps } from "../AnimeCard/anime-card.types";
import { AnimeListScreenHeaderLeft } from "./AnimeListScreenHeaderLeft";
import { AnimeListScreenHeaderRight } from "./AnimeListScreenHeaderRight";
import { AnimeListScreenHeaderTitle } from "./AnimeListScreenHeaderTitle";
import {
  deriveVisibleSyncStatus as deriveSharedVisibleSyncStatus,
  isManualSyncAvailableNow,
} from '../../../sync/sync-visible-status.helpers';
import type {
  AnimeListScreenContextualHeader,
  AnimeListScreenFilterCounts,
  AnimeListScreenHeaderLayout,
  AnimeListScreenHeaderLeftProps,
  AnimeListScreenHeaderRightProps,
  AnimeListScreenHeaderTitleProps,
  AnimeListScreenManualSyncAvailabilityFacts,
  AnimeListScreenRefreshFeedback,
  AnimeListScreenRenderModel,
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

/**
 * Formats the Spanish count subtitle: "Sin animes", "1 anime" or "3 animes". The title above already
 * names the day or premiere stage, so the count needs no qualifier, and zero keeps the line reading as
 * the count.
 */
function buildCountSubtitle(count: number): string {
  if (count === 0) {
    return "Sin animes";
  }
  return count === 1 ? "1 anime" : `${count} animes`;
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
  let actionLabel: string | null = null;
  if (facts.pendingOpsCount > 0 && facts.isBridgeConfigured === false) {
    actionLabel = ANIME_LIST_SCREEN_SYNC_PAIR_ACTION_LABEL;
  } else if (facts.pendingOpsCount > 0 && facts.isDeviceOnline !== false) {
    actionLabel = ANIME_LIST_SCREEN_SYNC_SETTINGS_ACTION_LABEL;
  }

  return {
    ...status,
    actionLabel,
  };
}

/**
 * Builds the warning toast copy shown when a manual refresh fails from the anime list.
 * The message stays aligned with the shared visible-status model so device-offline and PC-unreachable cases do not blur together.
 */
export function buildRefreshFailureFeedback(
  facts: AnimeListScreenSyncFacts,
): AnimeListScreenRefreshFeedback {
  if (facts.isDeviceOnline === false) {
    return {
      label: 'Sin Wi-Fi.',
      description:
        'Tus cambios siguen guardados en este dispositivo. Se enviarán cuando vuelvas a conectarte.',
    };
  }

  return {
    label: 'No se pudo contactar a la PC.',
    description:
      'Tus cambios siguen guardados en este dispositivo. Se enviarán solos cuando la PC esté encendida.',
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

  // The line always reads as the count, zero included; the empty state in the middle is what explains
  // an empty list, so the two never repeat each other.
  const subtitle = isToday
    ? `${buildCountSubtitle(count)} · ${formatTodayLabel(now)}`
    : buildCountSubtitle(count);

  return {
    title,
    subtitle,
    isToday,
  };
}

/**
 * Derives the bar's fixed side columns (96 on a phone, 240 on a tablet) and the width left for the
 * centered title, so the status button never covers the title.
 */
export function deriveHeaderLayout(
  layoutMode: LayoutMode,
  frameWidth: number,
): AnimeListScreenHeaderLayout {
  const sideColumnWidth =
    layoutMode === "phone"
      ? ANIME_LIST_SCREEN_HEADER_SIDE_WIDTH.phone
      : ANIME_LIST_SCREEN_HEADER_SIDE_WIDTH.tablet;

  return {
    sideColumnStyle: { width: sideColumnWidth },
    titleStyle: {
      maxWidth: Math.max(
        0,
        frameWidth - 2 * (sideColumnWidth + ANIME_LIST_SCREEN_HEADER_EDGE_INSET),
      ),
    },
  };
}

/** Builds the Stack header-title renderer that truncates the title inside its column. */
function buildHeaderTitleRenderer(
  props: AnimeListScreenHeaderTitleProps,
): () => ReactElement {
  return function renderHeaderTitle() {
    return createElement(AnimeListScreenHeaderTitle, props);
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

/**
 * Builds the Stack screen options of the anime list: the truncated title and both fixed-width
 * side columns, from the render model.
 */
export function buildAnimeListScreenOptions(model: AnimeListScreenRenderModel) {
  return {
    headerTitle: buildHeaderTitleRenderer({
      title: model.contextualHeader.title,
      style: model.headerLayout.titleStyle,
    }),
    headerLeft: buildHeaderLeftRenderer({
      handleOpenSettings: model.handleOpenSettings,
      sideColumnStyle: model.headerLayout.sideColumnStyle,
      themeColorForeground: model.themeColorForeground,
    }),
    headerRight: buildHeaderRightRenderer({
      refreshAccessibilityLabel: model.refreshAccessibilityLabel,
      isRefreshing: model.isRefreshing,
      isManualSyncEnabled: model.isManualSyncEnabled,
      sideColumnStyle: model.headerLayout.sideColumnStyle,
      syncStatus: model.syncStatus,
      themeColorForeground: model.themeColorForeground,
      handleOpenSyncSheet: model.handleOpenSyncSheet,
      handleRefreshPress: model.handleRefreshPress,
    }),
  };
}

/** Extracts the FlatList key for an anime list item from its persisted `_id`. */
export function getAnimeListItemKey(item: AnimeListItem): string {
  return item._id;
}

/**
 * Builds the stable FlatList renderItem function outside the screen component.
 * This avoids redefining a JSX-producing function (and the inline-FlatList-renderItem
 * perf trap) on every AnimeListScreenContent render.
 */
export function buildAnimeListItemRenderer(
  getAnimeCardProps: (item: AnimeListItem) => AnimeCardProps,
  cellClassName: string | undefined,
): (info: ListRenderItemInfo<AnimeListItem>) => ReactElement {
  return function renderAnimeListItem({ item }: ListRenderItemInfo<AnimeListItem>) {
    return createElement(
      View,
      { className: cellClassName },
      createElement(AnimeCard, getAnimeCardProps(item)),
    );
  };
}

/**
 * Builds the stable pull-to-refresh control outside the screen component.
 * Keeping the element factory in helpers clears the JSX-as-prop and inline-handler
 * findings while the screen itself stays a dumb view.
 */
export function buildAnimeListRefreshControl(
  enabled: boolean,
  refreshing: boolean,
  handleRefresh: () => Promise<void>,
): ReactElement<RefreshControlProps> {
  return createElement(RefreshControl, {
    enabled,
    refreshing,
    onRefresh: () => {
      void handleRefresh();
    },
  });
}
