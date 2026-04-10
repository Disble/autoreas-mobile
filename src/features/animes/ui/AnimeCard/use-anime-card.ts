import { useMemo } from 'react';
import type { AnimeCardProps } from './anime-card.types';
import {
  calculateProgress,
  canDecrease,
  canIncrease,
  getIsCompleted,
  isAnimeMutationLocked,
} from './anime-card.helpers';

export function useAnimeCard(props: AnimeCardProps) {
  // 1. Refs
  // 2. State
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

  const daysList = props.anime.dias || [];
  const genresList = props.anime.generos || [];

  // 6. Callbacks
  // 7. Effects

  return {
    progress,
    isCompleted,
    disableDecrease,
    disableIncrease,
    daysList,
    genresList,
  };
}
