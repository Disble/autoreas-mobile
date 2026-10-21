/* eslint-disable react-doctor/jsx-max-depth -- HeroUI BottomSheet compound shape (BottomSheet > Portal > Content > ...) sets the depth before any content starts. */
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import {
  ANIME_STATE_SHEET_TITLE,
  TONE_LABEL_CLASS,
} from './anime-state-sheet.constants';
import type { AnimeStateSheetOptionRowProps, AnimeStateSheetProps } from './anime-state-sheet.types';
import { useAnimeStateSheet } from './use-anime-state-sheet';
import { useAnimeStateSheetOptionRow } from './use-anime-state-sheet-option-row';
import { SheetContent } from '../../../../components/sheet-content';

/** Renders the anime state sheet interface. */
export function AnimeStateSheet(props: Readonly<AnimeStateSheetProps>) {
  const { isOpen, options, toneIconColors, selectedIconColor, handleSelect, handleClose } =
    useAnimeStateSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleClose}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <SheetContent isOpen={isOpen} contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5">
          <BottomSheet.Title className="text-foreground text-lg font-semibold">
            {ANIME_STATE_SHEET_TITLE}
          </BottomSheet.Title>

          <View className="gap-2">
            {options.map((option) => (
              <AnimeStateSheetOptionRow
                key={option.value}
                option={option}
                iconColor={toneIconColors[option.tone]}
                selectedIconColor={selectedIconColor}
                onSelect={handleSelect}
              />
            ))}
          </View>
        </SheetContent>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

/** Renders one state option: its icon, label and description, with a check when it is current. */
function AnimeStateSheetOptionRow(props: Readonly<AnimeStateSheetOptionRowProps>) {
  const { option, iconColor, selectedIconColor } = props;
  const { accessibilityState, handlePress } = useAnimeStateSheetOptionRow(props);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={option.label}
      onPress={handlePress}
      className={cn(
        'flex-row items-center gap-3 rounded-2xl border px-4 py-3',
        option.isSelected ? 'border-accent/40 bg-accent/15' : 'border-transparent bg-surface-secondary',
      )}
    >
      <Ionicons
        name={option.icon as ComponentProps<typeof Ionicons>['name']}
        size={24}
        color={iconColor}
      />
      <View className="flex-1">
        <AppText className={cn('text-base font-semibold', TONE_LABEL_CLASS[option.tone])}>
          {option.label}
        </AppText>
        <AppText className="text-muted text-sm">{option.description}</AppText>
      </View>
      {option.isSelected && <Ionicons name="checkmark" size={22} color={selectedIconColor} />}
    </Pressable>
  );
}
