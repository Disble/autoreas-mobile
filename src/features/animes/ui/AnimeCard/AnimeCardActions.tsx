import { Ionicons } from '@expo/vector-icons';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { Button, Spinner } from 'heroui-native';
import { View } from 'react-native';
import { AnimeCardChapterControls } from './AnimeCardChapterControls';
import type { AnimeCardActionsProps } from './anime-card.types';

/** Renders the page and folder shortcuts on the left, and the season CTA plus chapter progress on the right. */
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
    isOpeningFolder,
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
          onPress={onOpenPage}
        >
          <StyledIonicons name="link" size={18} className="text-foreground" />
        </Button>
      ) : null}
      {hasFolder ? (
        <Button
          accessibilityLabel={isOpeningFolder ? 'Abriendo carpeta' : 'Abrir carpeta del anime'}
          isIconOnly
          size="sm"
          variant="tertiary"
          isDisabled={isOpeningFolder}
          onPress={onOpenFolder}
        >
          {isOpeningFolder ? (
            <Spinner size="sm" />
          ) : (
            <StyledIonicons name="folder-open" size={18} className="text-foreground" />
          )}
        </Button>
      ) : null}
      <View className="flex-1" />
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
