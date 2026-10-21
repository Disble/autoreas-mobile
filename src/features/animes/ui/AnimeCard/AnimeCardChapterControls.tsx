import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { CARD_TOUCH_SLOP } from './anime-card.constants';
import { Button, cn } from 'heroui-native';
import { View } from 'react-native';
import type { AnimeCardChapterControlsProps } from './anime-card.types';

/**
 * Renders the decrease/increase stepper for an unlocked anime, 12 pt apart and with no number between
 * them: the watched count already leads the meta line under the title.
 * Both buttons draw a 40 pt box (`size-10`) with a 20 pt icon and reach a 48 pt touch target through
 * `hitSlop={CARD_TOUCH_SLOP}`, so the control grows as an area and not as a visual.
 */
export function AnimeCardChapterControls(props: Readonly<AnimeCardChapterControlsProps>) {
  const {
    disableDecrease,
    disableIncrease,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <View className="flex-row items-center gap-3">
      <Button
        accessibilityLabel="Restar un capítulo visto"
        variant="tertiary"
        isIconOnly
        hitSlop={CARD_TOUCH_SLOP}
        onPress={onCapMinusPress}
        onLongPress={onCapMinusLongPress}
        isDisabled={disableDecrease}
        className={cn('size-10', disableDecrease ? 'opacity-40' : undefined)}
      >
        <StyledIonicons name="remove-outline" size={20} className="text-default-foreground" />
      </Button>
      <Button
        accessibilityLabel="Sumar un capítulo visto"
        variant="primary"
        isIconOnly
        hitSlop={CARD_TOUCH_SLOP}
        onPress={onCapPlusPress}
        onLongPress={onCapPlusLongPress}
        isDisabled={disableIncrease}
        className={cn('size-10', disableIncrease ? 'opacity-40' : undefined)}
      >
        <StyledIonicons name="add-outline" size={20} className="text-accent-foreground" />
      </Button>
    </View>
  );
}
