import { Ionicons } from '@expo/vector-icons';
import { Button, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeCardChapterControlsProps } from './anime-card.types';

/** Renders the decrease/count/increase chapter controls for an unlocked anime. */
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
        accessibilityLabel="Decrease chapter"
        variant="danger"
        isIconOnly
        onPress={onCapMinusPress}
        onLongPress={onCapMinusLongPress}
        isDisabled={disableDecrease}
        className={cn('size-10', disableDecrease ? 'opacity-40' : undefined)}
      >
        <Ionicons name="remove" size={22} color="#ffffff" />
      </Button>
      <AppText className="text-foreground min-w-9 text-center text-base font-semibold tabular-nums">
        {nrocapvisto}
      </AppText>
      <Button
        accessibilityLabel="Increase chapter"
        variant="primary"
        isIconOnly
        onPress={onCapPlusPress}
        onLongPress={onCapPlusLongPress}
        isDisabled={disableIncrease}
        className={cn('size-10', disableIncrease ? 'opacity-40' : undefined)}
      >
        <Ionicons name="add" size={22} color="#ffffff" />
      </Button>
    </>
  );
}
