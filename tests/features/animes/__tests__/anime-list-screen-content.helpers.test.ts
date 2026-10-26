import { RefreshControl, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import type { ReactElement } from "react";
import { AnimeListScreenItem } from "../../../../src/features/animes/ui/AnimeListScreen/AnimeListScreenItem";
import type { AnimeListScreenItemProps } from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types";
import type { AnimeListItem } from "../../../../src/features/animes/anime-season.types";
import {
  buildAnimeListItemRenderer,
  buildAnimeListRefreshControl,
  getAnimeListItemKey,
} from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.helpers";
import { buildAnimeCardAnime } from "./anime-card-test.helpers";

/** Builds a minimal anime list item fixture by widening the shared AnimeCard anime fixture. */
function buildListItem(): AnimeListItem {
  return buildAnimeCardAnime() as AnimeListItem;
}

/** The element shape `buildAnimeListItemRenderer` returns: a cell View wrapping one list row. */
type AnimeListCellElement = ReactElement<{
  readonly className?: string;
  readonly children: ReactElement<AnimeListScreenItemProps>;
}>;

/** Builds the row props `getAnimeListItemProps` would hand the renderer for one item. */
function buildItemProps(anime: AnimeListItem): AnimeListScreenItemProps {
  return {
    anime,
    folderPath: null,
    handleCapMinus: jest.fn(),
    handleCapMinusHalf: jest.fn(),
    handleCapPlus: jest.fn(),
    handleCapPlusHalf: jest.fn(),
    handleOpenSeasonRatingSheet: jest.fn(),
    handleOpenStateSheet: jest.fn(),
  };
}

/** Builds a no-op separators object matching FlatList's `renderItem` contract. */
function buildSeparators(): ListRenderItemInfo<AnimeListItem>["separators"] {
  return {
    highlight: jest.fn(),
    unhighlight: jest.fn(),
    updateProps: jest.fn(),
  };
}

describe("getAnimeListItemKey", () => {
  it("returns the anime `_id` as the FlatList key", () => {
    const item = buildListItem();

    expect(getAnimeListItemKey(item)).toBe(item._id);
  });
});

describe("buildAnimeListItemRenderer", () => {
  it("wraps the item's row in a View carrying the given cell class name", () => {
    const item = buildListItem();
    const itemProps = buildItemProps(item);
    const getAnimeListItemProps = jest.fn().mockReturnValue(itemProps);

    const renderItem = buildAnimeListItemRenderer(getAnimeListItemProps, "flex-[0.5] px-2");
    const element = renderItem({ item, index: 0, separators: buildSeparators() }) as AnimeListCellElement;

    expect(element.type).toBe(View);
    expect(element.props.className).toBe("flex-[0.5] px-2");
    expect(element.props.children.type).toBe(AnimeListScreenItem);
    expect(element.props.children.props).toEqual(itemProps);
    expect(getAnimeListItemProps).toHaveBeenCalledWith(item);
  });

  it("renders without a cell class name in the single-column layout", () => {
    const item = buildListItem();
    const getAnimeListItemProps = jest.fn().mockReturnValue(buildItemProps(item));

    const renderItem = buildAnimeListItemRenderer(getAnimeListItemProps, undefined);
    const element = renderItem({ item, index: 0, separators: buildSeparators() }) as AnimeListCellElement;

    expect(element.props.className).toBeUndefined();
  });
});

describe("buildAnimeListRefreshControl", () => {
  it("carries the manual-sync gate and refreshing state through to RefreshControl", () => {
    const handleRefresh = jest.fn().mockResolvedValue(undefined);

    const element = buildAnimeListRefreshControl(true, false, handleRefresh);

    expect(element.type).toBe(RefreshControl);
    expect(element.props.enabled).toBe(true);
    expect(element.props.refreshing).toBe(false);
  });

  it("calls handleRefresh from onRefresh without leaking the returned promise", () => {
    const handleRefresh = jest.fn().mockResolvedValue(undefined);
    const element = buildAnimeListRefreshControl(true, false, handleRefresh);

    const result = element.props.onRefresh?.();

    expect(handleRefresh).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});
