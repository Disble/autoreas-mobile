import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import {
  ANIME_STATE_SHEET_TITLE,
  TONE_ICON_COLOR,
  TONE_LABEL_CLASS,
} from './anime-state-sheet.constants';
import type { AnimeStateSheetProps } from './anime-state-sheet.types';
import { useAnimeStateSheet } from './use-anime-state-sheet';

export function AnimeStateSheet(props: AnimeStateSheetProps) {
  const { visible, options, handleSelect, handleClose } = useAnimeStateSheet(props);
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['45%'], []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  const renderBackdrop = useMemo(
    () =>
      function Backdrop(backdropProps: BottomSheetBackdropProps) {
        return (
          <BottomSheetBackdrop
            {...backdropProps}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            pressBehavior="close"
          />
        );
      },
    [],
  );

  if (!visible) {
    return null;
  }

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={handleClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: 'transparent' }}
    >
      <BottomSheetView className="bg-background flex-1 px-4 pb-6 pt-2">
        <AppText className="text-foreground mb-4 text-lg font-bold">
          {ANIME_STATE_SHEET_TITLE}
        </AppText>
        <View className="gap-2">
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: option.isSelected }}
              accessibilityLabel={option.label}
              onPress={() => handleSelect(option.value)}
              className={cn(
                'flex-row items-center gap-3 rounded-xl px-4 py-3',
                option.isSelected ? 'bg-accent/15' : 'bg-surface-secondary',
              )}
            >
              <Ionicons
                name={option.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={24}
                color={TONE_ICON_COLOR[option.tone]}
              />
              <View className="flex-1">
                <AppText
                  className={cn('text-base font-semibold', TONE_LABEL_CLASS[option.tone])}
                >
                  {option.label}
                </AppText>
                <AppText className="text-muted text-sm">{option.description}</AppText>
              </View>
              {option.isSelected && <Ionicons name="checkmark" size={22} color="#22c55e" />}
            </Pressable>
          ))}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
