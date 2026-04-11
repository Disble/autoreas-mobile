import React from 'react';
import { View } from 'react-native';
import { useThemeColor } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../../components/app-text';
import type { AnimeEmptyStateViewProps } from './anime-empty-state.types';

export function AnimeEmptyStateView(props: AnimeEmptyStateViewProps) {
  const { icon, message, hint } = props;
  const [accentColor] = useThemeColor(['accent']);

  return (
    <View className="mx-auto w-full max-w-md flex-1 items-center justify-center px-6 pb-10 pt-4">
      <View className="bg-accent/10 mb-5 h-16 w-16 items-center justify-center rounded-2xl">
        <Ionicons name={icon as any} size={32} color={accentColor} />
      </View>
      <AppText className="text-foreground text-center text-base font-semibold">
        {message}
      </AppText>
      <AppText className="text-muted mt-1.5 text-center text-[13px] leading-snug">
        {hint}
      </AppText>
    </View>
  );
}
