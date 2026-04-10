import { useCallback, useMemo, useRef, useState } from 'react';
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
  const onCapMinusRef = useRef(props.onCapMinus);
  const onCapPlusRef = useRef(props.onCapPlus);
  const onCapMinusHalfRef = useRef(props.onCapMinusHalf);
  const onCapPlusHalfRef = useRef(props.onCapPlusHalf);
  const onOpenStateSheetRef = useRef(props.onOpenStateSheet);
  // Keep refs in sync during render so rapid alternating taps never see a callback from the prior commit.
  onCapMinusRef.current = props.onCapMinus;
  onCapPlusRef.current = props.onCapPlus;
  onCapMinusHalfRef.current = props.onCapMinusHalf;
  onCapPlusHalfRef.current = props.onCapPlusHalf;
  onOpenStateSheetRef.current = props.onOpenStateSheet;

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

  const handleCapMinusPress = useCallback(() => {
    onCapMinusRef.current();
  }, []);

  const handleCapPlusPress = useCallback(() => {
    onCapPlusRef.current();
  }, []);

  const handleStateBadgePress = useCallback(() => {
    onOpenStateSheetRef.current?.(props.anime._id, props.anime.estado);
  }, [props.anime._id, props.anime.estado]);

  const handleCapPlusLongPress = useCallback(() => {
    onCapPlusHalfRef.current?.();
  }, []);

  const handleCapMinusLongPress = useCallback(() => {
    onCapMinusHalfRef.current?.();
  }, []);

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
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
  };
}
