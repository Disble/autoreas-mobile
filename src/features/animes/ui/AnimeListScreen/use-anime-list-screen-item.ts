import { useCoverUriStore } from "../../../../infrastructure/store/cover-uri-store/cover-uri-store.constants";
import type { AnimeCardProps } from "../AnimeCard/anime-card.types";
import type { AnimeListScreenItemProps } from "./anime-list-screen.types";

/**
 * Builds the AnimeCard props of one list row. The row subscribes to its own cover only, so a cover
 * arriving for another anime does not re-render it, and React Compiler keeps the card props (and so
 * the card) unchanged while the row's anime, lock, folder and handlers are unchanged.
 */
export function useAnimeListScreenItem(props: AnimeListScreenItemProps): AnimeCardProps {
  const {
    anime,
    isMutating,
    folderPath,
    handleCapMinus,
    handleCapMinusHalf,
    handleCapPlus,
    handleCapPlusHalf,
    handleOpenSeasonRatingSheet,
    handleOpenStateSheet,
  } = props;
  const animeId = anime._id;

  // 3. Context/3rd Party Hooks
  const coverUri = useCoverUriStore((state) => state.coverUriByAnimeId[animeId] ?? null);

  // 6. Callbacks
  const onCapMinus = () => {
    void handleCapMinus(animeId);
  };
  const onCapPlus = () => {
    void handleCapPlus(animeId);
  };
  const onCapMinusHalf = () => {
    void handleCapMinusHalf(animeId);
  };
  const onCapPlusHalf = () => {
    void handleCapPlusHalf(animeId);
  };

  return {
    anime,
    isMutating,
    coverUri,
    folderPath,
    onCapMinus,
    onCapPlus,
    onCapMinusHalf,
    onCapPlusHalf,
    onOpenSeasonRatingSheet: handleOpenSeasonRatingSheet,
    onOpenStateSheet: handleOpenStateSheet,
  };
}
