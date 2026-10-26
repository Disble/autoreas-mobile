import { act, renderHook } from "@testing-library/react-native";
import type { AnimeListScreenItemProps } from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types";
import { useAnimeListScreenItem } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen-item";
import { useCoverUriStore } from "../../../../src/infrastructure/store/cover-uri-store";
import { buildAnimeListItemFixture } from "./use-anime-list-item-renderer.helpers";

/** Builds one row's props with spy handlers, for the anime with the given id. */
function buildItemProps(
  id: string,
  overrides: Partial<AnimeListScreenItemProps> = {},
): AnimeListScreenItemProps {
  return {
    anime: buildAnimeListItemFixture(id, { estado: 2 }),
    folderPath: null,
    handleCapMinus: jest.fn().mockResolvedValue(undefined),
    handleCapMinusHalf: jest.fn().mockResolvedValue(undefined),
    handleCapPlus: jest.fn().mockResolvedValue(undefined),
    handleCapPlusHalf: jest.fn().mockResolvedValue(undefined),
    handleOpenSeasonRatingSheet: jest.fn(),
    handleOpenStateSheet: jest.fn(),
    ...overrides,
  };
}

describe("useAnimeListScreenItem", () => {
  afterEach(() => {
    act(() => {
      useCoverUriStore.setState({ coverUriByAnimeId: {} });
    });
  });

  it("builds the AnimeCard props of its row: anime and folder", () => {
    const props = buildItemProps("anime-1", {
      folderPath: "/storage/0123-4567/Videos/Anime/Bleach",
    });

    const { result } = renderHook(() => useAnimeListScreenItem(props));

    expect(result.current.anime).toBe(props.anime);
    expect(result.current.folderPath).toBe("/storage/0123-4567/Videos/Anime/Bleach");
  });

  it("wires every AnimeCard action to the screen handler with the row's anime id", () => {
    const props = buildItemProps("anime-2");
    const { result } = renderHook(() => useAnimeListScreenItem(props));

    act(() => {
      result.current.onCapMinus();
      result.current.onCapPlus();
      result.current.onCapMinusHalf?.();
      result.current.onCapPlusHalf?.();
      result.current.onOpenSeasonRatingSheet?.("anime-2");
      result.current.onOpenStateSheet?.("anime-2", 2);
    });

    expect(props.handleCapMinus).toHaveBeenCalledWith("anime-2");
    expect(props.handleCapPlus).toHaveBeenCalledWith("anime-2");
    expect(props.handleCapMinusHalf).toHaveBeenCalledWith("anime-2");
    expect(props.handleCapPlusHalf).toHaveBeenCalledWith("anime-2");
    expect(props.handleOpenSeasonRatingSheet).toHaveBeenCalledWith("anime-2");
    expect(props.handleOpenStateSheet).toHaveBeenCalledWith("anime-2", 2);
  });

  it("reads only its own cover from the cover-uri-store, reacting to a store update", () => {
    const props = buildItemProps("anime-1");
    const { result } = renderHook(() => useAnimeListScreenItem(props));

    expect(result.current.coverUri).toBeNull();

    act(() => {
      useCoverUriStore.getState().setCoverUris({ "anime-1": "file:///covers/anime-1.jpg" });
    });

    expect(result.current.coverUri).toBe("file:///covers/anime-1.jpg");
  });

  it("does not re-render when only another anime's cover arrives", () => {
    let renderCount = 0;
    const props = buildItemProps("anime-1");
    const { result } = renderHook(() => {
      renderCount += 1;
      return useAnimeListScreenItem(props);
    });
    const rendersBefore = renderCount;

    act(() => {
      useCoverUriStore.getState().setCoverUris({ "anime-2": "file:///covers/anime-2.jpg" });
    });

    expect(renderCount).toBe(rendersBefore);
    expect(result.current.coverUri).toBeNull();
  });
});
