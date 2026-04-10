import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Button, Select } from 'heroui-native';
import { FlatList, Pressable, View } from 'react-native';
import { AnimeEmptyState } from '../AnimeEmptyState';
import type { AnimeListScreenViewProps } from './anime-list-screen.types';
import { renderAnimeListItem } from './anime-list-screen.helpers';

export function AnimeListScreenView(props: AnimeListScreenViewProps) {
  const {
    animes,
    filterOptions,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    isRefreshing,
    refreshAccessibilityLabel,
    selectedFilterOption,
    selectListLabel,
    selectPlaceholder,
    themeColorForeground,
    handleCapMinus,
    handleCapPlus,
    handleOpenSettings,
    handleRefresh,
    handleSelectedFilterChange,
  } = props;

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

      <View className="flex-row items-center gap-2 px-4 pb-2 pt-20">
        <View className="flex-1">
          <Select
            onValueChange={handleSelectedFilterChange}
            presentation="bottom-sheet"
            value={selectedFilterOption}
          >
            <Select.Trigger>
              <Select.Value placeholder={selectPlaceholder} />
              <Select.TriggerIndicator />
            </Select.Trigger>
            <Select.Portal>
              <Select.Overlay />
              <Select.Content presentation="bottom-sheet" snapPoints={['50%']}>
                <Select.ListLabel>{selectListLabel}</Select.ListLabel>
                {filterOptions.map((filterOption) => (
                  <Select.Item
                    key={filterOption.value}
                    label={filterOption.label}
                    value={filterOption.value}
                  />
                ))}
              </Select.Content>
            </Select.Portal>
          </Select>
        </View>

        <Button
          accessibilityLabel={refreshAccessibilityLabel}
          isDisabled={isRefreshing}
          isIconOnly
          onPress={() => {
            void handleRefresh();
          }}
          size="sm"
          variant="secondary"
        >
          <Ionicons name="refresh" size={18} />
        </Button>
      </View>

      {isEmpty ? (
        <AnimeEmptyState filter={selectedFilterOption.value} />
      ) : (
        <FlatList
          contentContainerClassName="px-4 pt-2 pb-10"
          data={animes}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) =>
            renderAnimeListItem(item, isMutatingAnimeById, handleCapMinus, handleCapPlus)
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}
