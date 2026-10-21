import { useMemo, useState } from 'react';
import { getOpenablePageUrl } from '../../../anime-folders/anime-folders.helpers';
import { openDeviceFolder, openPageUrl } from '../../../anime-folders/anime-folders-io.helpers';
import { META_TOGGLE_HINT } from './anime-card.constants';
import type { AnimeCardProps } from './anime-card.types';
import {
  canDecrease,
  canIncrease,
  getAnimeSeasonStatus,
  getLongEpisodeLabel,
  getRestantesLabel,
  getStateChip,
  isAnimeMutationLocked,
  tapChapterHaptic,
} from './anime-card.helpers';
import { useAnimeCardFeedback } from './use-anime-card-feedback';

/** Coordinates anime card state and actions. */
export function useAnimeCard(props: AnimeCardProps) {
  // 1. Refs

  // 2. State
  const [restantesShown, setRestantesShown] = useState(false);

  // 3. Third-party/Context hooks
  const { countStyle, lineStyle, plusStyle } = useAnimeCardFeedback(props.anime.nrocapvisto);
  // 4. Mutations/Queries

  // 5. Derived state
  const isMutationLocked = isAnimeMutationLocked(props.anime.estado);

  const disableDecrease =
    props.isMutating || isMutationLocked || !canDecrease(props.anime.nrocapvisto);

  const disableIncrease =
    props.isMutating ||
    isMutationLocked ||
    !canIncrease(props.anime.nrocapvisto, props.anime.totalcap);

  const stateChip = getStateChip(props.anime.estado);

  const restantesLabel = getRestantesLabel(props.anime.nrocapvisto, props.anime.totalcap);
  const metaToggleHint = restantesLabel ? META_TOGGLE_HINT : undefined;
  const seasonStatus = getAnimeSeasonStatus(props.anime.seasonProjection);
  const longEpisodeLabel = getLongEpisodeLabel(props.anime.episodes, props.anime.nrocapvisto);
  const pageUrl = getOpenablePageUrl(props.anime.pagina);
  const folderPath = props.folderPath ?? null;
  const feedback = useMemo(
    () => ({ countStyle, lineStyle, plusStyle }),
    [countStyle, lineStyle, plusStyle],
  );

  // 6. Callbacks
  const toggleRestantesShown = () => {
    setRestantesShown((current) => !current);
  };

  const handleCapMinusPress = () => {
    tapChapterHaptic();
    props.onCapMinus();
  };

  const handleCapPlusPress = () => {
    tapChapterHaptic();
    props.onCapPlus();
  };

  const handleStateBadgePress = () => {
    props.onOpenStateSheet?.(props.anime._id, props.anime.estado);
  };

  const handleCapPlusLongPress = () => {
    tapChapterHaptic();
    props.onCapPlusHalf?.();
  };

  const handleCapMinusLongPress = () => {
    tapChapterHaptic();
    props.onCapMinusHalf?.();
  };

  const handleOpenSeasonRatingSheet = () => {
    props.onOpenSeasonRatingSheet?.(props.anime._id);
  };

  const handleOpenPage = () => {
    if (pageUrl) {
      openPageUrl(pageUrl);
    }
  };

  const handleOpenFolder = () => {
    if (folderPath) {
      openDeviceFolder(folderPath);
    }
  };

  // 7. Effects

  return {
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    seasonStatus,
    longEpisodeLabel,
    restantesShown,
    restantesLabel,
    metaToggleHint,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
    hasPageLink: pageUrl !== null,
    hasFolder: folderPath !== null,
    handleOpenPage,
    handleOpenFolder,
    feedback,
  };
}
