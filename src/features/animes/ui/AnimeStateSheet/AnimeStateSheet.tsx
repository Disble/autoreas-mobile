import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import {
  ANIME_STATE_SHEET_TITLE,
  TONE_LABEL_CLASS,
} from './anime-state-sheet.constants';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';
import { useAnimeStateSheet } from './use-anime-state-sheet';

/** Renders the anime state sheet interface. */
export function AnimeStateSheet(props: Readonly<AnimeStateSheetProps>) {
  const { isOpen, options, toneIconColors, selectedIconColor, handleSelect, handleClose } =
    useAnimeStateSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleClose}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5">
          <BottomSheet.Title className="text-foreground text-lg font-semibold">
            {ANIME_STATE_SHEET_TITLE}
          </BottomSheet.Title>

          <View className="gap-2">
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: option.isSelected }}
                accessibilityLabel={option.label}
                onPress={() => handleSelect(option.value)}
                className={cn(
                  'flex-row items-center gap-3 rounded-2xl border px-4 py-3',
                  option.isSelected
                    ? 'border-accent/40 bg-accent/15'
                    : 'border-transparent bg-surface-secondary',
                )}
              >
                <Ionicons
                  name={option.icon as ComponentProps<typeof Ionicons>['name']}
                  size={24}
                  color={toneIconColors[option.tone]}
                />
                <View className="flex-1">
                  <AppText
                    className={cn('text-base font-semibold', TONE_LABEL_CLASS[option.tone])}
                  >
                    {option.label}
                  </AppText>
                  <AppText className="text-muted text-sm">{option.description}</AppText>
                </View>
                {option.isSelected && (
                  <Ionicons name="checkmark" size={22} color={selectedIconColor} />
                )}
              </Pressable>
            ))}
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
