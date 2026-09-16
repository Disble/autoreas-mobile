import { RefreshControl, View } from "react-native";
import type { ListRenderItemInfo } from "react-native";
import type { ReactElement } from "react";
import { AnimeCard } from "../../../../src/features/animes/ui/AnimeCard";
import type { AnimeCardProps } from "../../../../src/features/animes/ui/AnimeCard";
import type { AnimeListItem } from "../../../../src/features/animes/anime-season.types";
import {
  buildAnimeListItemRenderer,
  buildAnimeListRefreshControl,
  getAnimeListItemKey,
} from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.helpers";
import { buildAnimeCardAnime, buildAnimeCardProps } from "./anime-card-test.helpers";

/** Builds a minimal anime list item fixture by widening the shared AnimeCard anime fixture. */
function buildListItem(): AnimeListItem {
  return buildAnimeCardAnime() as AnimeListItem;
}

/** The element shape `buildAnimeListItemRenderer` returns: a cell View wrapping one AnimeCard. */
type AnimeListCellElement = ReactElement<{
  readonly className?: string;
  readonly children: ReactElement<AnimeCardProps>;
}>;

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
  it("wraps the AnimeCard in a View carrying the given cell class name", () => {
    const item = buildListItem();
    const cardProps = buildAnimeCardProps({ anime: item });
    const getAnimeCardProps = jest.fn().mockReturnValue(cardProps);

    const renderItem = buildAnimeListItemRenderer(getAnimeCardProps, "flex-[0.5] px-2");
    const element = renderItem({ item, index: 0, separators: buildSeparators() }) as AnimeListCellElement;

    expect(element.type).toBe(View);
    expect(element.props.className).toBe("flex-[0.5] px-2");
    expect(element.props.children.type).toBe(AnimeCard);
    expect(element.props.children.props).toEqual(cardProps);
    expect(getAnimeCardProps).toHaveBeenCalledWith(item);
  });

  it("renders without a cell class name in the single-column layout", () => {
    const item = buildListItem();
    const getAnimeCardProps = jest.fn().mockReturnValue(buildAnimeCardProps({ anime: item }));

    const renderItem = buildAnimeListItemRenderer(getAnimeCardProps, undefined);
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
