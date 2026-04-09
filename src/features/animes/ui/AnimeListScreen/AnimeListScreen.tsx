import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'heroui-native';
import { FlatList, Pressable, View } from 'react-native';
import { AnimeCard } from '../AnimeCard';
import { AnimeEmptyState } from '../AnimeEmptyState';
import { TAB_OPTIONS } from '../../anime.constants';
import type { AnimeListScreenProps } from './anime-list-screen.types';
import { useAnimeListScreen } from './use-anime-list-screen';

export function AnimeListScreen(props: AnimeListScreenProps) {
  const {
    animes,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    tab,
    themeColorForeground,
    handleCapMinus,
    handleCapPlus,
    handleOpenSettings,
    handleTabChange,
  } = useAnimeListScreen(props);

  return (
    <View className="flex-1 min-w-[320px] bg-background">
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Abrir configuración"
              accessibilityRole="button"
              hitSlop={12}
              onPress={handleOpenSettings}
            >
              <Ionicons
                color={themeColorForeground}
                name="settings-outline"
                size={22}
              />
            </Pressable>
          ),
        }}
      />

      <View className="px-4 pb-2 pt-4">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <Tabs.List className="w-full">
            <Tabs.Indicator />
            {TAB_OPTIONS.map((tabOption) => (
              <Tabs.Trigger key={tabOption.value} value={tabOption.value}>
                <Tabs.Label>{tabOption.label}</Tabs.Label>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </View>

      {isEmpty ? (
        <AnimeEmptyState tab={tab} />
      ) : (
        <FlatList
          contentContainerClassName="px-4 pt-2 pb-10"
          data={animes}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <AnimeCard
              anime={item}
              isMutating={!!isMutatingAnimeById[item._id]}
              onCapMinus={() => handleCapMinus(item._id)}
              onCapPlus={() => handleCapPlus(item._id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}
