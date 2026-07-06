import { act, renderHook } from "@testing-library/react-native";
import { useAnimeListItemRenderer } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-item-renderer";
import { buildAnimeListItemFixture } from "./use-anime-list-item-renderer.helpers";

describe("useAnimeListItemRenderer", () => {
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
});
