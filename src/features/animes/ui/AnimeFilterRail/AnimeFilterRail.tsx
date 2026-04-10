import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Chip, cn } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import type { AnimeFilterRailProps } from './anime-filter-rail.types';
import { useAnimeFilterRail } from './use-anime-filter-rail';

export function AnimeFilterRail(props: AnimeFilterRailProps) {
  const { items, orientation, handleSelect } = useAnimeFilterRail(props);

  if (orientation === 'horizontal') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row gap-2 px-4 py-2"
      >
        {items.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: item.isSelected }}
            accessibilityLabel={`${item.label}${item.count > 0 ? `, ${item.count}` : ''}`}
            onPress={() => handleSelect(item.value)}
            hitSlop={8}
          >
            <Chip
              size="md"
              variant={item.isSelected ? 'primary' : 'tertiary'}
              color={item.isToday ? 'accent' : 'default'}
            >
              <Chip.Label>
                {item.label}
                {item.count > 0 ? `  ·  ${item.count}` : ''}
              </Chip.Label>
            </Chip>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-2 px-3 py-3"
    >
      {items.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="button"
          accessibilityState={{ selected: item.isSelected }}
          accessibilityLabel={`${item.label}${item.count > 0 ? `, ${item.count}` : ''}`}
          onPress={() => handleSelect(item.value)}
          hitSlop={8}
          className={cn(
            'flex-row items-center justify-between rounded-xl px-4 py-3',
            item.isSelected ? 'bg-accent/15' : 'bg-surface-secondary',
          )}
        >
          <View className="flex-row items-center gap-2">
            <AppText
              className={cn(
                'text-base',
                item.isSelected ? 'text-accent font-semibold' : 'text-foreground',
              )}
            >
              {item.label}
            </AppText>
            {item.isToday && (
              <Chip size="sm" variant="secondary" color="accent">
                <Chip.Label>Hoy</Chip.Label>
              </Chip>
            )}
          </View>
          <AppText className="text-muted text-sm font-semibold">
            {item.count}
          </AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}
