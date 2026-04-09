import React from 'react';
import { View } from 'react-native';
import { Surface } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../../components/app-text';
import type { AnimeEmptyStateViewProps } from './anime-empty-state.types';

export function AnimeEmptyStateView(props: AnimeEmptyStateViewProps) {
  const { icon, message, hint } = props;

  return (
    <View className="flex-1 items-center justify-center px-6 py-20">
      <Surface
        variant="secondary"
        className="w-full items-center rounded-2xl px-8 py-10"
      >
        <Ionicons name={icon as any} size={56} color="#9ca3af" />
        <AppText className="text-foreground mt-4 text-center text-lg font-semibold">
          {message}
        </AppText>
        <AppText className="text-muted mt-2 text-center text-sm">
          {hint}
        </AppText>
      </Surface>
    </View>
  );
}
