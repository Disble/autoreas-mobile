import * as Clipboard from 'expo-clipboard';
import { useToast } from 'heroui-native';
import { useState } from 'react';
import { getOpenablePageUrl } from '../../../anime-folders/anime-folders.helpers';
import { openDeviceFolder, openPageUrl } from '../../../anime-folders/anime-folders-io.helpers';
import {
  META_TOGGLE_HINT,
  TITLE_COPIED_LABEL,
  TITLE_COPY_FAILED_LABEL,
} from './anime-card.constants';
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
  const [restantesShown, setRestantesShown] = useState(false);

  // 3. Third-party/Context hooks
  const { toast } = useToast();
  // 4. Mutations/Queries

  // 5. Derived state
  const isMutationLocked = isAnimeMutationLocked(props.anime.estado);

  const disableDecrease =
    isMutationLocked || !canDecrease(props.anime.nrocapvisto);

  const disableIncrease =
    isMutationLocked || !canIncrease(props.anime.nrocapvisto, props.anime.totalcap);

  const stateChip = getStateChip(props.anime.estado);

  const restantesLabel = getRestantesLabel(props.anime.nrocapvisto, props.anime.totalcap);
  const metaToggleHint = restantesLabel ? META_TOGGLE_HINT : undefined;
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
    if (folderPath) {
      openDeviceFolder(folderPath);
    }
  };

  // The title is the anime's name exactly as stored, so what lands on the clipboard is what other
  // apps (a search, a tracker) need to find it.
  const handleCopyTitle = async () => {
    try {
      await Clipboard.setStringAsync(props.anime.nombre);
      toast.show({ label: TITLE_COPIED_LABEL, placement: 'bottom' });
    } catch {
      toast.show({ variant: 'danger', label: TITLE_COPY_FAILED_LABEL, placement: 'bottom' });
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
    handleCopyTitle,
  };
}
