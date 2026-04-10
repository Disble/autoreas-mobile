import { useCallback } from "react";
import type { AnimeCardProps } from "../AnimeCard/anime-card.types";
import type { AnimeListScreenViewProps } from "./anime-list-screen.types";

export function useAnimeListItemRenderer(
  isMutatingAnimeById: AnimeListScreenViewProps["isMutatingAnimeById"],
  handleCapMinus: AnimeListScreenViewProps["handleCapMinus"],
  handleCapPlus: AnimeListScreenViewProps["handleCapPlus"],
  handleCapPlusHalf: AnimeListScreenViewProps["handleCapPlusHalf"],
  handleCapMinusHalf: AnimeListScreenViewProps["handleCapMinusHalf"],
  handleOpenStateSheet: AnimeListScreenViewProps["handleOpenStateSheet"],
) {
  const getAnimeCardProps = useCallback(
    (item: AnimeListScreenViewProps["animes"][number]): AnimeCardProps => ({
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
      onOpenStateSheet: (animeId, currentEstado) => {
        handleOpenStateSheet(animeId, currentEstado);
      },
    }),
    [
      handleCapMinus,
      handleCapMinusHalf,
      handleCapPlus,
      handleCapPlusHalf,
      handleOpenStateSheet,
      isMutatingAnimeById,
    ],
  );

  return {
    getAnimeCardProps,
  };
}
