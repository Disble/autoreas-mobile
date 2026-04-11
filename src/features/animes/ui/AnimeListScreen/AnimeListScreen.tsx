import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Button } from "heroui-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { AppText } from "../../../../components/app-text";
import { AnimeCard } from "../AnimeCard";
import { AnimeEmptyState } from "../AnimeEmptyState";
import { AnimeFilterRail } from "../AnimeFilterRail";
import { AnimeStateSheet } from "../AnimeStateSheet";
import { ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS } from "./anime-list-screen.constants";
import type { AnimeListScreenViewProps } from "./anime-list-screen.types";
import { useAnimeListItemRenderer } from "./use-anime-list-item-renderer";

export function AnimeListScreenView(props: AnimeListScreenViewProps) {
  const {
    animes,
    filterOptions,
    filterCounts,
    contextualHeader,
    layoutMode,
    isMutatingAnimeById,
    isDark,
    isEmpty,
    isRefreshing,
    refreshAccessibilityLabel,
    selectedFilter,
    stateSheetRequest,
    themeColorForeground,
    today,
    handleCapMinus,
    handleCapMinusHalf,
    handleCapPlus,
    handleCapPlusHalf,
    handleCloseStateSheet,
    handleOpenSettings,
    handleOpenStateSheet,
    handleRefresh,
    handleSelectedFilterChange,
    handleStateSheetSelect,
  } = props;

  const isTabletLandscape = layoutMode === "tablet-landscape";
  const numColumns = isTabletLandscape
    ? ANIME_LIST_SCREEN_TABLET_LANDSCAPE_COLUMNS
    : 1;
  const { getAnimeCardProps } = useAnimeListItemRenderer(
    isMutatingAnimeById,
    handleCapMinus,
    handleCapPlus,
    handleCapPlusHalf,
    handleCapMinusHalf,
    handleOpenStateSheet,
  );

  return (
    <View className="bg-background flex-1">
      <Stack.Screen
        options={{
          headerTitle: contextualHeader.title,
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
          headerRight: () => (
            <Button
              accessibilityLabel={refreshAccessibilityLabel}
              isDisabled={isRefreshing}
              isIconOnly
              onPress={() => {
                void handleRefresh();
              }}
              size="sm"
              variant="ghost"
            >
              <Ionicons name="refresh" color={themeColorForeground} size={20} />
            </Button>
          ),
        }}
      />

      <View
        className={isTabletLandscape ? "flex-1 flex-row pt-16" : "flex-1 pt-16"}
      >
        {isTabletLandscape ? (
          <View className="bg-surface-secondary/40 border-border/40 w-60 border-r">
            <AnimeFilterRail
              options={filterOptions}
              counts={filterCounts}
              selected={selectedFilter}
              today={today}
              orientation="vertical"
              onSelect={handleSelectedFilterChange}
            />
          </View>
        ) : (
          <AnimeFilterRail
            options={filterOptions}
            counts={filterCounts}
            selected={selectedFilter}
            today={today}
            orientation="horizontal"
            onSelect={handleSelectedFilterChange}
          />
        )}

        <View className="flex-1">
          <View className="mx-auto w-full max-w-5xl px-5 pb-3 pt-2">
            <View className="flex-row items-center gap-2">
              {contextualHeader.isToday && (
                <View className="bg-accent h-2 w-2 rounded-full" />
              )}
              <AppText className="text-muted text-sm">
                {contextualHeader.subtitle}
              </AppText>
            </View>
          </View>

          {isEmpty ? (
            <AnimeEmptyState filter={selectedFilter} />
          ) : (
            <FlatList
              contentContainerClassName="mx-auto w-full max-w-5xl px-5 pb-12"
              data={animes}
              extraData={isMutatingAnimeById}
              key={`anime-list-${numColumns}`}
              keyExtractor={(item) => item._id}
              numColumns={numColumns}
              columnWrapperClassName={numColumns > 1 ? "gap-4" : undefined}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => {
                    void handleRefresh();
                  }}
                />
              }
              renderItem={({ item }) => (
                <View className={numColumns > 1 ? "flex-1" : undefined}>
                  <AnimeCard {...getAnimeCardProps(item)} />
                </View>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      <AnimeStateSheet
        visible={stateSheetRequest !== null}
        currentEstado={stateSheetRequest?.currentEstado ?? 0}
        onSelect={(estado) => {
          void handleStateSheetSelect(estado);
        }}
        onClose={handleCloseStateSheet}
      />

      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  );
}
