import { useCoverUriStore } from "../../../../infrastructure/store/cover-uri-store/cover-uri-store.constants";
import type { AnimeCardProps } from "../AnimeCard/anime-card.types";
import type { AnimeListScreenViewModel } from "./anime-list-screen.types";

/** Coordinates anime list item renderer state and actions. */
export function useAnimeListItemRenderer(
  isMutatingAnimeById: AnimeListScreenViewModel["isMutatingAnimeById"],
  handleCapMinus: AnimeListScreenViewModel["handleCapMinus"],
  handleCapPlus: AnimeListScreenViewModel["handleCapPlus"],
  handleCapPlusHalf: AnimeListScreenViewModel["handleCapPlusHalf"],
  handleCapMinusHalf: AnimeListScreenViewModel["handleCapMinusHalf"],
  handleOpenSeasonRatingSheet: AnimeListScreenViewModel["handleOpenSeasonRatingSheet"],
  handleOpenStateSheet: AnimeListScreenViewModel["handleOpenStateSheet"],
) {
  // 3. Context/3rd Party Hooks
  const coverUriByAnimeId = useCoverUriStore((state) => state.coverUriByAnimeId);

  // 6. Callbacks (calling pure helpers)
  const getAnimeCardProps = (
    item: AnimeListScreenViewModel["animes"][number],
  ): AnimeCardProps => ({
    anime: item,
    isMutating: !!isMutatingAnimeById[item._id],
    coverUri: coverUriByAnimeId[item._id] ?? null,
    onCapMinus: () => {
      void handleCapMinus(item._id);
    },
    onCapPlus: () => {
      void handleCapPlus(item._id);
    },
    onCapMinusHalf: () => {
      void handleCapMinusHalf(item._id);
    },
    onCapPlusHalf: () => {
      void handleCapPlusHalf(item._id);
    },
    onOpenSeasonRatingSheet: (animeId) => {
      handleOpenSeasonRatingSheet(animeId);
    },
    onOpenStateSheet: (animeId, currentEstado) => {
      handleOpenStateSheet(animeId, currentEstado);
    },
  });

  return {
    getAnimeCardProps,
  };
}
