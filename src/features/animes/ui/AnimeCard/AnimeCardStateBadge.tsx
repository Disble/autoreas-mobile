import { Pressable } from 'react-native';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import type { AnimeCardStateBadgeProps } from './anime-card.types';
import { CARD_ELLIPSIS_TOUCH_SLOP } from './anime-card.constants';

/**
 * Renders the anime card state affordance: one muted ellipsis for every persisted state.
 * The state itself is text on the meta line, so no coloured chip is drawn here; the ellipsis
 * only carries the state into its accessibility label and opens the existing state sheet.
 * Its 28 pt box plus 8 pt of hit slop on every side reaches the 44 pt touch target.
 */
export function AnimeCardStateBadge({ stateChip, onPress }: Readonly<AnimeCardStateBadgeProps>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cambiar estado: ${stateChip.label}`}
      onPress={onPress}
      hitSlop={CARD_ELLIPSIS_TOUCH_SLOP}
      className="h-7 w-7 items-center justify-center rounded-full"
    >
      <StyledIonicons className="text-muted" name="ellipsis-horizontal-outline" size={18} />
    </Pressable>
  );
}
