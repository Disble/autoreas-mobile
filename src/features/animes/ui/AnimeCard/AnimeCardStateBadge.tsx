import { Chip } from 'heroui-native';
import { Pressable } from 'react-native';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { CHIP_TONE_COLOR_MAP } from './anime-card.constants';
import type { AnimeCardStateBadgeProps } from './anime-card.types';

/**
 * Renders the anime card state affordance: a muted ellipsis for the default
 * Viendo state, or a state chip for every other persisted state.
 */
export function AnimeCardStateBadge({ stateChip, onPress }: Readonly<AnimeCardStateBadgeProps>) {
  if (stateChip.isDefault) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cambiar estado del anime"
        onPress={onPress}
        hitSlop={10}
        className="h-7 w-7 items-center justify-center rounded-full"
      >
        <StyledIonicons className="text-muted" name="ellipsis-horizontal" size={18} />
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cambiar estado: ${stateChip.label}`}
      onPress={onPress}
      hitSlop={8}
    >
      <Chip size="sm" variant="secondary" color={CHIP_TONE_COLOR_MAP[stateChip.tone]}>
        <Chip.Label>{stateChip.label}</Chip.Label>
      </Chip>
    </Pressable>
  );
}
