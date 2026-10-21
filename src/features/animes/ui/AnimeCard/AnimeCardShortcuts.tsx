import { CARD_TOUCH_SLOP } from './anime-card.constants';
import { StyledIonicons } from '../../../../components/theme-toggle.constants';
import { Button } from 'heroui-native';
import { View } from 'react-native';
import type { AnimeCardShortcutsProps } from './anime-card.types';

/**
 * Renders the left group of the actions row: page, folder and note star, each shown only when it has
 * somewhere to go.
 * Every button draws a 40 pt box (`size="sm"`) with a 20 pt outline icon and reaches a 48 pt touch
 * target through `hitSlop={CARD_TOUCH_SLOP}`.
 */
export function AnimeCardShortcuts(props: Readonly<AnimeCardShortcutsProps>) {
  const { hasPageLink, hasFolder, showNoteStar, onOpenPage, onOpenFolder, onOpenSeasonRatingSheet } =
    props;

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
          <StyledIonicons name="link-outline" size={20} className="text-foreground" />
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
          <StyledIonicons name="folder-outline" size={20} className="text-foreground" />
        </Button>
      ) : null}
      {showNoteStar ? (
        <Button
          accessibilityLabel="Abrir la calificación de la nota"
          isIconOnly
          size="sm"
          variant="tertiary"
          hitSlop={CARD_TOUCH_SLOP}
          onPress={onOpenSeasonRatingSheet}
        >
          <StyledIonicons name="star-outline" size={20} className="text-accent-soft-foreground" />
        </Button>
      ) : null}
    </View>
  );
}
