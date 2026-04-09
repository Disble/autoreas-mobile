import { useMemo } from 'react';
import type { AnimeEmptyStateProps } from './anime-empty-state.types';
import { ICONS, MESSAGES, HINTS } from './anime-empty-state.constants';

export function useAnimeEmptyState(props: AnimeEmptyStateProps) {
  // 1. Refs
  // 2. State
  // 3. Third-party/Context hooks
  // 4. Mutations/Queries

  // 5. Derived state
  const icon = useMemo(() => ICONS[props.tab], [props.tab]);
  const message = useMemo(() => MESSAGES[props.tab], [props.tab]);
  const hint = useMemo(() => HINTS[props.tab], [props.tab]);

  // 6. Callbacks
  // 7. Effects

  return {
    icon,
    message,
    hint,
  };
}
