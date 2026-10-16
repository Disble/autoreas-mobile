import { useEffect, useRef, useState } from 'react';
import { getOpenablePageUrl } from '../../../anime-folders/anime-folders.helpers';
import { openDeviceFolder, openPageUrl } from '../../../anime-folders/anime-folders-io.helpers';
import { FOLDER_OPENING_FEEDBACK_MS } from './anime-card.constants';
import type { AnimeCardProps } from './anime-card.types';
import {
  canDecrease,
  canIncrease,
  getAnimeSeasonStatus,
  getLongEpisodeLabel,
  getRestantesLabel,
  getStateChip,
  isAnimeMutationLocked,
} from './anime-card.helpers';

/** Coordinates anime card state and actions. */
export function useAnimeCard(props: AnimeCardProps) {
  // 1. Refs

  // 2. State
  /** Timer that ends the folder opening state. */
  const folderOpeningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restantesShown, setRestantesShown] = useState(false);
  /** True from a folder tap until My Files is expected to be up; there is no signal from My Files. */
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);

  // 3. Third-party/Context hooks
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
  const seasonStatus = getAnimeSeasonStatus(props.anime.seasonProjection);
  const longEpisodeLabel = getLongEpisodeLabel(props.anime.episodes, props.anime.nrocapvisto);
  const pageUrl = getOpenablePageUrl(props.anime.pagina);
  const folderPath = props.folderPath ?? null;

  // 6. Callbacks
  const toggleRestantesShown = () => {
    setRestantesShown((current) => !current);
  };

  const handleCapMinusPress = () => {
    props.onCapMinus();
  };

  const handleCapPlusPress = () => {
    props.onCapPlus();
  };

  const handleStateBadgePress = () => {
    props.onOpenStateSheet?.(props.anime._id, props.anime.estado);
  };

  const handleCapPlusLongPress = () => {
    props.onCapPlusHalf?.();
  };

  const handleCapMinusLongPress = () => {
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
    if (!folderPath) {
      return;
    }

    setIsOpeningFolder(true);
    openDeviceFolder(folderPath);
    folderOpeningTimerRef.current = setTimeout(() => {
      setIsOpeningFolder(false);
    }, FOLDER_OPENING_FEEDBACK_MS);
  };

  // 7. Effects
  useEffect(
    () => () => {
      if (folderOpeningTimerRef.current) {
        clearTimeout(folderOpeningTimerRef.current);
      }
    },
    [],
  );

  return {
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    seasonStatus,
    longEpisodeLabel,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
    hasPageLink: pageUrl !== null,
    hasFolder: folderPath !== null,
    isOpeningFolder,
    handleOpenPage,
    handleOpenFolder,
  };
}
