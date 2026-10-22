import { renderHook } from "@testing-library/react-native";
import { useAnimeFolderArrival } from "../../../../src/features/anime-folders/use-anime-folder-arrival";
import { useAnimeFolderResolution } from "../../../../src/features/anime-folders/use-anime-folder-resolution";
import { useAnimeListItemRenderer } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-item-renderer";
import { buildAnimeListItemFixture } from "./use-anime-list-item-renderer.helpers";

jest.mock("../../../../src/features/anime-folders/use-anime-folder-resolution", () => ({
  useAnimeFolderResolution: jest.fn(() => null),
}));

jest.mock("../../../../src/features/anime-folders/use-anime-folder-arrival", () => ({
  useAnimeFolderArrival: jest.fn(),
}));

/** Builds the screen-level handlers the renderer forwards to every row. */
function buildHandlers() {
  return {
    handleCapMinus: jest.fn().mockResolvedValue(undefined),
    handleCapPlus: jest.fn().mockResolvedValue(undefined),
    handleCapPlusHalf: jest.fn().mockResolvedValue(undefined),
    handleCapMinusHalf: jest.fn().mockResolvedValue(undefined),
    handleOpenSeasonRatingSheet: jest.fn(),
    handleOpenStateSheet: jest.fn(),
  };
}

/** Renders the renderer hook with the given lock record and handlers. */
function renderRenderer(
  isMutatingAnimeById: Record<string, boolean>,
  handlers = buildHandlers(),
) {
  return renderHook(() =>
    useAnimeListItemRenderer(
      isMutatingAnimeById,
      handlers.handleCapMinus,
      handlers.handleCapPlus,
      handlers.handleCapPlusHalf,
      handlers.handleCapMinusHalf,
      handlers.handleOpenSeasonRatingSheet,
      handlers.handleOpenStateSheet,
    ),
  );
}

describe("useAnimeListItemRenderer", () => {
  it("watches for anime folders that reach the tablet late while the list is mounted", () => {
    renderRenderer({});

    expect(useAnimeFolderArrival).toHaveBeenCalled();
  });

  it("hands each row its own lock and the screen handlers unchanged", () => {
    const handlers = buildHandlers();
    const item = buildAnimeListItemFixture("anime-1");
    const { result } = renderRenderer({ "anime-1": true }, handlers);

    const itemProps = result.current.getAnimeListItemProps(item);

    expect(itemProps).toEqual({ anime: item, isMutating: true, folderPath: null, ...handlers });
    expect(itemProps.handleCapPlus).toBe(handlers.handleCapPlus);
    expect(
      result.current.getAnimeListItemProps(buildAnimeListItemFixture("anime-2")).isMutating,
    ).toBe(false);
  });

  it("passes the resolved folder path to the row, and none to an anime without one", () => {
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

    const { result } = renderRenderer({});

    expect(
      result.current.getAnimeListItemProps(buildAnimeListItemFixture("anime-1")).folderPath,
    ).toBe(devicePath);
    expect(
      result.current.getAnimeListItemProps(buildAnimeListItemFixture("anime-2")).folderPath,
    ).toBeNull();
  });
});
