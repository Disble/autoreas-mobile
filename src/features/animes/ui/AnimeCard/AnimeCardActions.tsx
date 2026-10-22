import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { CARD_TOUCH_SLOP } from './anime-card.constants';
import { Button } from 'heroui-native';
import { View } from 'react-native';
import { AnimeCardChapterControls } from './AnimeCardChapterControls';
import { AnimeCardShortcuts } from './AnimeCardShortcuts';
import type { AnimeCardActionsProps } from './anime-card.types';

/**
 * Renders the page, folder and note shortcuts as one group on the left, and the chapter stepper (or
 * `Reanudar` for a locked anime) on the right.
 * `Reanudar` is a tertiary button like the shortcuts, with an 18 pt play icon. It draws a 40 pt box
 * (`size="sm"`) and reaches a 48 pt touch target through
 * `hitSlop={CARD_TOUCH_SLOP}`, like every icon button in the row.
 */
export function AnimeCardActions(props: Readonly<AnimeCardActionsProps>) {
  const {
    seasonStatus,
    isMutationLocked,
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
      <AnimeCardShortcuts
        hasPageLink={hasPageLink}
        hasFolder={hasFolder}
        showNoteStar={seasonStatus?.showRatingCta === true}
        onOpenPage={onOpenPage}
        onOpenFolder={onOpenFolder}
        onOpenSeasonRatingSheet={onOpenSeasonRatingSheet}
      />
      <View className="flex-1" />
      {isMutationLocked ? (
        <Button
          accessibilityLabel="Reanudar anime"
          variant="tertiary"
          size="sm"
          hitSlop={CARD_TOUCH_SLOP}
          onPress={onReanudarPress}
        >
          <StyledIonicons name="play-outline" size={18} className="text-foreground" />
          <Button.Label>Reanudar</Button.Label>
        </Button>
      ) : (
        <AnimeCardChapterControls
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
