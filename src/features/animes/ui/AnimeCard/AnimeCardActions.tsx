import { Ionicons } from '@expo/vector-icons';
import { CARD_TOUCH_SLOP } from './anime-card.constants';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { Button } from 'heroui-native';
import { View } from 'react-native';
import { AnimeCardChapterControls } from './AnimeCardChapterControls';
import type { AnimeCardActionsProps } from './anime-card.types';

/**
 * Renders the page and folder shortcuts on the left, and the season CTA plus chapter progress on the right.
 * Every button here draws a 40 pt box (`size="sm"`) and reaches a 48 pt touch target through
 * `hitSlop={CARD_TOUCH_SLOP}`, so neither the visual weight nor the row rhythm changes.
 */
export function AnimeCardActions(props: Readonly<AnimeCardActionsProps>) {
  const {
    seasonStatus,
    isMutationLocked,
    nrocapvisto,
    disableDecrease,
    disableIncrease,
    onOpenSeasonRatingSheet,
    hasPageLink,
    hasFolder,
    onOpenPage,
    onOpenFolder,
    onReanudarPress,
    onCapMinusPress,
    onCapPlusPress,
    onCapMinusLongPress,
    onCapPlusLongPress,
  } = props;

  return (
    <View className="flex-row items-center gap-2">
      {hasPageLink ? (
        <Button
          accessibilityLabel="Abrir página del anime"
          isIconOnly
          size="sm"
          variant="tertiary"
          hitSlop={CARD_TOUCH_SLOP}
          onPress={onOpenPage}
        >
          <StyledIonicons name="link" size={18} className="text-foreground" />
        </Button>
      ) : null}
      {hasFolder ? (
        <Button
          accessibilityLabel="Abrir carpeta del anime"
          isIconOnly
          size="sm"
          variant="tertiary"
          hitSlop={CARD_TOUCH_SLOP}
          onPress={onOpenFolder}
        >
          <StyledIonicons name="folder-open" size={18} className="text-foreground" />
        </Button>
      ) : null}
      <View className="flex-1" />
      {seasonStatus?.showRatingCta ? (
        <Button
          accessibilityLabel="Abrir calificación de temporada"
          onPress={onOpenSeasonRatingSheet}
          size="sm"
          variant="secondary"
          hitSlop={CARD_TOUCH_SLOP}
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
          hitSlop={CARD_TOUCH_SLOP}
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
