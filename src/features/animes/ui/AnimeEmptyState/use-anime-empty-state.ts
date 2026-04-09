import { useMemo } from 'react';
import type { AnimeEmptyStateProps } from './anime-empty-state.types';
import { buildAnimeEmptyState } from './anime-empty-state.helpers';

export function useAnimeEmptyState(props: AnimeEmptyStateProps) {
  // 1. Refs
  // 2. State
  // 3. Third-party/Context hooks
  // 4. Mutations/Queries

  // 5. Derived state
  const emptyState = useMemo(() => buildAnimeEmptyState(props.filter), [props.filter]);

  // 6. Callbacks
  // 7. Effects

  return {
    ...emptyState,
  };
}
