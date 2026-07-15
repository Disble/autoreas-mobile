import { useCallback } from "react";
import type { AnimeCardProps } from "../AnimeCard";
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
  const getAnimeCardProps = useCallback(
    (item: AnimeListScreenViewModel["animes"][number]): AnimeCardProps => ({
      anime: item,
      isMutating: !!isMutatingAnimeById[item._id],
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
    }),
    [
      handleCapMinus,
      handleCapMinusHalf,
      handleCapPlus,
      handleCapPlusHalf,
      handleOpenSeasonRatingSheet,
      handleOpenStateSheet,
      isMutatingAnimeById,
    ],
  );

  return {
    getAnimeCardProps,
  };
}
