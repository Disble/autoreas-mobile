import { Ionicons } from '@expo/vector-icons';
import { Button } from 'heroui-native';
import { View } from 'react-native';
import { AnimeCardChapterControls } from './AnimeCardChapterControls';
import type { AnimeCardActionsProps } from './anime-card.types';

/** Renders the anime card season CTA and the chapter progress actions. */
export function AnimeCardActions(props: Readonly<AnimeCardActionsProps>) {
  const {
    seasonStatus,
    isMutationLocked,
    nrocapvisto,
    disableDecrease,
    disableIncrease,
    onOpenSeasonRatingSheet,
    onReanudarPress,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <View className="flex-row items-center justify-end gap-2">
      {seasonStatus?.showRatingCta ? (
        <Button
          accessibilityLabel="Abrir calificación de temporada"
          onPress={onOpenSeasonRatingSheet}
          size="sm"
          variant="secondary"
          className="mr-4"
        >
          <Button.Label>Temporada</Button.Label>
        </Button>
      ) : null}
      {isMutationLocked ? (
        <Button
          accessibilityLabel="Reanudar anime"
          variant="secondary"
          size="sm"
          onPress={onReanudarPress}
        >
          <Ionicons name="play" size={14} />
          <Button.Label>Reanudar</Button.Label>
        </Button>
      ) : (
        <AnimeCardChapterControls
          nrocapvisto={nrocapvisto}
          disableDecrease={disableDecrease}
          disableIncrease={disableIncrease}
          onCapMinusPress={onCapMinusPress}
          onCapPlusPress={onCapPlusPress}
          onCapMinusLongPress={onCapMinusLongPress}
          onCapPlusLongPress={onCapPlusLongPress}
        />
      )}
    </View>
  );
}
