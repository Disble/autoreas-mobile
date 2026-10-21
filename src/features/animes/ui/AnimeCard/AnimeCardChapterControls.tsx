import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { CARD_TOUCH_SLOP } from './anime-card.constants';
import { Button, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeCardChapterControlsProps } from './anime-card.types';

/**
 * Renders the decrease/count/increase chapter controls for an unlocked anime.
 * Both buttons draw a 40 pt box (`size-10`) and reach a 48 pt touch target through
 * `hitSlop={CARD_TOUCH_SLOP}`, so the control grows as an area and not as a visual.
 */
export function AnimeCardChapterControls(props: Readonly<AnimeCardChapterControlsProps>) {
  const {
    nrocapvisto,
    disableDecrease,
    disableIncrease,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <>
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
        <StyledIonicons name="remove-outline" size={22} className="text-default-foreground" />
      </Button>
      <AppText className="text-foreground min-w-9 text-center text-base font-semibold tabular-nums">
        {nrocapvisto}
      </AppText>
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
        <StyledIonicons name="add-outline" size={22} className="text-accent-foreground" />
      </Button>
    </>
  );
}
