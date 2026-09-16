import { useState } from 'react';
import type { AnimeCardProps } from './anime-card.types';
import {
  canDecrease,
  canIncrease,
  getAnimeSeasonStatus,
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

  // 7. Effects

  return {
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    seasonStatus,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
  };
}
