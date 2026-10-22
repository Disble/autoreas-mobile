import { useAnimeFolderArrival } from "../../../anime-folders/use-anime-folder-arrival";
import { useAnimeFolderResolution } from "../../../anime-folders/use-anime-folder-resolution";
import type { AnimeListItem } from "../../anime-season.types";
import type {
  AnimeListScreenItemProps,
  AnimeListScreenViewModel,
} from "./anime-list-screen.types";

/**
 * Coordinates the list rows: resolves the folders once for the whole list and hands each row only
 * the values that are its own (its lock, its folder path) plus the screen's id-taking handlers. A row
 * reads its own cover itself (`useAnimeListScreenItem`), so the cover map is not a dependency here.
 */
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
  const folderResolution = useAnimeFolderResolution();
  // The list stays mounted while the app is open, so folders that arrive late are found here.
  useAnimeFolderArrival();

  // 6. Callbacks (calling pure helpers)
  const getAnimeListItemProps = (item: AnimeListItem): AnimeListScreenItemProps => ({
    anime: item,
    isMutating: !!isMutatingAnimeById[item._id],
    folderPath: folderResolution?.byAnimeId.get(item._id)?.folder.devicePath ?? null,
    handleCapMinus,
    handleCapMinusHalf,
    handleCapPlus,
    handleCapPlusHalf,
    handleOpenSeasonRatingSheet,
    handleOpenStateSheet,
  });

  return {
    getAnimeListItemProps,
  };
}
