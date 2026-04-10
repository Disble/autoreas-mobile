import { useCallback, useMemo, useState } from 'react';
import type { AnimeCardProps } from './anime-card.types';
import {
  calculateProgress,
  canDecrease,
  canIncrease,
  getIsCompleted,
  getRestantesLabel,
  getStateChip,
  isAnimeMutationLocked,
} from './anime-card.helpers';

export function useAnimeCard(props: AnimeCardProps) {
  // 1. Refs
  // 2. State
  const [restantesShown, setRestantesShown] = useState(false);

  // 3. Third-party/Context hooks
  // 4. Mutations/Queries

  // 5. Derived state
  const progress = useMemo(
    () => calculateProgress(props.anime.nrocapvisto, props.anime.totalcap),
    [props.anime.nrocapvisto, props.anime.totalcap]
  );

  const isCompleted = useMemo(() => getIsCompleted(progress), [progress]);

  const isMutationLocked = useMemo(
    () => isAnimeMutationLocked(props.anime.estado),
    [props.anime.estado]
  );

  const disableDecrease = useMemo(
    () => props.isMutating || isMutationLocked || !canDecrease(props.anime.nrocapvisto),
    [props.anime.nrocapvisto, props.isMutating, isMutationLocked]
  );

  const disableIncrease = useMemo(
    () =>
      props.isMutating ||
      isMutationLocked ||
      !canIncrease(props.anime.nrocapvisto, props.anime.totalcap),
    [props.anime.nrocapvisto, props.anime.totalcap, props.isMutating, isMutationLocked]
  );

  const stateChip = useMemo(
    () => getStateChip(props.anime.estado),
    [props.anime.estado]
  );

  const restantesLabel = useMemo(
    () => getRestantesLabel(props.anime.nrocapvisto, props.anime.totalcap),
    [props.anime.nrocapvisto, props.anime.totalcap]
  );

  const daysList = props.anime.dias || [];
  const genresList = props.anime.generos || [];

  // 6. Callbacks
  const toggleRestantesShown = useCallback(() => {
    setRestantesShown((current) => !current);
  }, []);

  const handleStateBadgePress = useCallback(() => {
    props.onOpenStateSheet?.(props.anime._id, props.anime.estado);
  }, [props]);

  const handleCapPlusLongPress = useCallback(() => {
    props.onCapPlusHalf?.();
  }, [props]);

  const handleCapMinusLongPress = useCallback(() => {
    props.onCapMinusHalf?.();
  }, [props]);

  // 7. Effects

  return {
    progress,
    isCompleted,
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    restantesShown,
    restantesLabel,
    daysList,
    genresList,
    toggleRestantesShown,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
  };
}
