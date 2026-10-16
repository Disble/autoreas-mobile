import { act, renderHook } from "@testing-library/react-native";
import { useAnimeFolderArrival } from "../../../../src/features/anime-folders/use-anime-folder-arrival";
import { useAnimeFolderResolution } from "../../../../src/features/anime-folders/use-anime-folder-resolution";
import { useAnimeListItemRenderer } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-item-renderer";
import { useCoverUriStore } from "../../../../src/infrastructure/store/cover-uri-store";
import { buildAnimeListItemFixture } from "./use-anime-list-item-renderer.helpers";

jest.mock("../../../../src/features/anime-folders/use-anime-folder-resolution", () => ({
  useAnimeFolderResolution: jest.fn(() => null),
}));

jest.mock("../../../../src/features/anime-folders/use-anime-folder-arrival", () => ({
  useAnimeFolderArrival: jest.fn(),
}));

describe("useAnimeListItemRenderer", () => {
  afterEach(() => {
    act(() => {
      useCoverUriStore.setState({ coverUriByAnimeId: {} });
    });
  });

  it("watches for anime folders that reach the tablet late while the list is mounted", () => {
    renderHook(() =>
      useAnimeListItemRenderer({}, jest.fn(), jest.fn(), jest.fn(), jest.fn(), jest.fn(), jest.fn()),
    );

    expect(useAnimeFolderArrival).toHaveBeenCalled();
  });

  it("builds AnimeCard props and forwards mutation state", () => {
    const item = buildAnimeListItemFixture("anime-1");
    const handleCapMinus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlusHalf = jest.fn().mockResolvedValue(undefined);
    const handleCapMinusHalf = jest.fn().mockResolvedValue(undefined);
    const handleOpenSeasonRatingSheet = jest.fn();
    const handleOpenStateSheet = jest.fn();

    const { result } = renderHook(() =>
      useAnimeListItemRenderer(
        { "anime-1": true },
        handleCapMinus,
        handleCapPlus,
        handleCapPlusHalf,
        handleCapMinusHalf,
        handleOpenSeasonRatingSheet,
        handleOpenStateSheet,
      ),
    );

    const cardProps = result.current.getAnimeCardProps(item);

    expect(cardProps.anime).toBe(item);
    expect(cardProps.isMutating).toBe(true);
  });

  it("wires AnimeCard actions to callbacks with the item id", () => {
    const item = buildAnimeListItemFixture("anime-2", { estado: 2 });
    const handleCapMinus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlus = jest.fn().mockResolvedValue(undefined);
    const handleCapPlusHalf = jest.fn().mockResolvedValue(undefined);
    const handleCapMinusHalf = jest.fn().mockResolvedValue(undefined);
    const handleOpenSeasonRatingSheet = jest.fn();
    const handleOpenStateSheet = jest.fn();

    const { result } = renderHook(() =>
      useAnimeListItemRenderer(
        {},
        handleCapMinus,
        handleCapPlus,
        handleCapPlusHalf,
        handleCapMinusHalf,
        handleOpenSeasonRatingSheet,
        handleOpenStateSheet,
      ),
    );

    const cardProps = result.current.getAnimeCardProps(item);

    act(() => {
      cardProps.onCapMinus();
      cardProps.onCapPlus();
      cardProps.onCapMinusHalf?.();
      cardProps.onCapPlusHalf?.();
      cardProps.onOpenSeasonRatingSheet?.("anime-2");
    });

    cardProps.onOpenStateSheet?.("anime-2", 2);

    expect(handleCapMinus).toHaveBeenCalledWith("anime-2");
    expect(handleCapPlus).toHaveBeenCalledWith("anime-2");
    expect(handleCapMinusHalf).toHaveBeenCalledWith("anime-2");
    expect(handleCapPlusHalf).toHaveBeenCalledWith("anime-2");
    expect(handleOpenSeasonRatingSheet).toHaveBeenCalledWith("anime-2");
    expect(handleOpenStateSheet).toHaveBeenCalledWith("anime-2", 2);
  });

  it("resolves coverUri from the cover-uri-store, reacting to a store update", () => {
    const item = buildAnimeListItemFixture("anime-1");
    const noop = jest.fn();
    const noopAsync = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useAnimeListItemRenderer({}, noopAsync, noopAsync, noopAsync, noopAsync, noop, noop),
    );

    expect(result.current.getAnimeCardProps(item).coverUri).toBeNull();

    act(() => {
      useCoverUriStore.getState().setCoverUris({ "anime-1": "file:///covers/anime-1.jpg" });
    });

    expect(result.current.getAnimeCardProps(item).coverUri).toBe("file:///covers/anime-1.jpg");
  });

  it("returns null for an anime id with no entry in the cover-uri-store", () => {
    const item = buildAnimeListItemFixture("anime-unknown");
    const noop = jest.fn();
    const noopAsync = jest.fn().mockResolvedValue(undefined);

    act(() => {
      useCoverUriStore.getState().setCoverUris({ "anime-1": "file:///covers/anime-1.jpg" });
    });

    const { result } = renderHook(() =>
      useAnimeListItemRenderer({}, noopAsync, noopAsync, noopAsync, noopAsync, noop, noop),
    );

    expect(result.current.getAnimeCardProps(item).coverUri).toBeNull();
  });

  it("passes the resolved folder path to the card, and none to an anime without one", () => {
    const noop = jest.fn();
    const noopAsync = jest.fn().mockResolvedValue(undefined);
    const devicePath = "/storage/0123-4567/Videos/Anime/Bleach";
    jest.mocked(useAnimeFolderResolution).mockReturnValue({
      byAnimeId: new Map([
        [
          "anime-1",
          { method: "exact", folder: { name: "Bleach", relativePath: "Bleach", devicePath } },
        ],
      ]),
      summary: {
        folderCount: 1,
        animesWithFolder: 1,
        matchedFolders: [],
        sharedFolders: [],
        unmatchedFolders: [],
      },
    });

    const { result } = renderHook(() =>
      useAnimeListItemRenderer({}, noopAsync, noopAsync, noopAsync, noopAsync, noop, noop),
    );

    expect(result.current.getAnimeCardProps(buildAnimeListItemFixture("anime-1")).folderPath).toBe(
      devicePath,
    );
    expect(
      result.current.getAnimeCardProps(buildAnimeListItemFixture("anime-2")).folderPath,
    ).toBeNull();
  });
});
