/* eslint-disable react-doctor/jsx-max-depth -- HeroUI BottomSheet compound shape (BottomSheet > Portal > Content > ...) sets the depth before any content starts. */
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import { ANIME_STATE_SHEET_TITLE, TONE_DOT_CLASS } from './anime-state-sheet.constants';
import type { AnimeStateSheetOptionRowProps, AnimeStateSheetProps } from './anime-state-sheet.types';
import { useAnimeStateSheet } from './use-anime-state-sheet';
import { useAnimeStateSheetOptionRow } from './use-anime-state-sheet-option-row';
import { SheetContent } from '../../../../components/sheet-content';

/** Renders the anime state sheet interface. */
export function AnimeStateSheet(props: Readonly<AnimeStateSheetProps>) {
  const { isOpen, animeTitle, options, checkColor, handleSelect, handleClose } =
    useAnimeStateSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleClose}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <SheetContent isOpen={isOpen} contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5">
          <View className="gap-1">
            <BottomSheet.Title className="text-foreground text-[17px] font-semibold">
              {ANIME_STATE_SHEET_TITLE}
            </BottomSheet.Title>
            <AppText className="text-muted text-[13px]" numberOfLines={2}>
              {animeTitle}
            </AppText>
          </View>

          <View accessibilityRole="radiogroup" className="gap-1">
            {options.map((option) => (
              <AnimeStateSheetOptionRow
                key={option.value}
                option={option}
                checkColor={checkColor}
                onSelect={handleSelect}
              />
            ))}
          </View>
        </SheetContent>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

/**
 * Renders one state option as a 48 pt row: a dot in the state's colour and its label, with a soft
 * fill and an accent check on the current one.
 */
function AnimeStateSheetOptionRow(props: Readonly<AnimeStateSheetOptionRowProps>) {
  const { option, checkColor } = props;
  const { accessibilityState, handlePress } = useAnimeStateSheetOptionRow(props);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      accessibilityLabel={option.label}
      onPress={handlePress}
      className={cn(
        'min-h-12 flex-row items-center gap-3 rounded-xl px-3',
        option.isSelected && 'bg-default',
      )}
    >
      <View className={TONE_DOT_CLASS[option.tone]} />
      <AppText className="text-foreground flex-1 text-[15px]">{option.label}</AppText>
      {option.isSelected && <Ionicons name="checkmark" size={20} color={checkColor} />}
    </Pressable>
  );
}
