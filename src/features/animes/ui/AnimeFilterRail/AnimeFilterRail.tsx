/* eslint-disable react-doctor/jsx-max-depth -- HeroUI Chip compound shape (layout View > Chip > Chip.Label) and the pill count badge set the depth. */
/* eslint-disable react-doctor/rn-no-scrollview-mapped-list -- the rail always holds exactly the ten day filters; a virtualized list buys nothing. */
import { Chip, cn } from "heroui-native";
import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "../../../../components/app-text";
import type {
  AnimeFilterRailEntryProps,
  AnimeFilterRailProps,
} from "./anime-filter-rail.types";
import { useAnimeFilterRail } from "./use-anime-filter-rail";
import { useAnimeFilterRailEntry } from "./use-anime-filter-rail-entry";

/**
 * Renders the anime filter rail: one horizontal chip rail on a phone, with an "Estrenos" separator
 * before the pseudo-days, or a vertical list for the tablet's floating filter panel.
 */
export function AnimeFilterRail(props: Readonly<AnimeFilterRailProps>) {
  const {
    items,
    orientation,
    scrollRef,
    handleChipLayout,
    handleSelect,
    handleViewportLayout,
  } = useAnimeFilterRail(props);

  if (orientation === "horizontal") {
    return (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        className="w-full flex-none"
        contentContainerClassName="flex-row items-center gap-2 px-4 pb-3 pt-1"
        onLayout={handleViewportLayout}
      >
        {items.map((item) => (
          <RailChip
            key={item.value}
            item={item}
            onChipLayout={handleChipLayout}
            onSelect={handleSelect}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-0.5 p-2">
      {items.map((item) => (
        <RailRow key={item.value} item={item} onSelect={handleSelect} />
      ))}
    </ScrollView>
  );
}

/** Renders one phone rail chip, preceded by the "Estrenos" separator on the first pseudo-day. */
function RailChip(props: Readonly<AnimeFilterRailEntryProps>) {
  const { item } = props;
  const { accessibilityLabel, accessibilityState, handleLayout, handlePress } =
    useAnimeFilterRailEntry(props);

  return (
    <>
      {item.isFirstPseudoDay && <RailSeparator />}
      <View onLayout={handleLayout}>
        <Chip
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={accessibilityLabel}
          onPress={handlePress}
          hitSlop={8}
          size="md"
          variant={item.isSelected ? "primary" : "tertiary"}
          color={item.isToday ? "accent" : "default"}
        >
          <Chip.Label>
            {item.label}
            {item.count > 0 ? `  ·  ${item.count}` : ""}
          </Chip.Label>
        </Chip>
      </View>
    </>
  );
}

/** Renders the phone rail's group break: a short rule and the "Estrenos" label. */
function RailSeparator() {
  return (
    <View className="flex-row items-center gap-2" testID="anime-filter-rail-separator">
      <View className="bg-separator h-5 w-px" />
      <AppText className="text-muted text-[11px] font-medium uppercase tracking-widest">
        Estrenos
      </AppText>
    </View>
  );
}

/**
 * Renders one row of the tablet filter panel. The selection is a soft accent fill (no side bar),
 * today keeps an accent label and dot, and a zero count is hidden.
 */
function RailRow(props: Readonly<AnimeFilterRailEntryProps>) {
  const { item } = props;
  const { accessibilityLabel, accessibilityState, handlePress } = useAnimeFilterRailEntry(props);

  return (
    <>
      {item.isFirstPseudoDay && (
        <AppText className="text-muted mx-3 mb-2 mt-4 text-[11px] font-medium uppercase tracking-widest">
          Estrenos
        </AppText>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
        className={cn(
          "min-h-11 flex-row items-center gap-2 rounded-xl px-3",
          item.isSelected ? "bg-accent/15" : "bg-transparent",
        )}
      >
        <AppText
          className={cn(
            "flex-1 text-[15px]",
            item.isToday ? "text-accent" : "text-reading",
            item.isSelected && "text-foreground font-medium",
          )}
          numberOfLines={1}
        >
          {item.label}
        </AppText>
        {item.isToday && <View className="bg-accent size-1.5 rounded-full" testID="anime-filter-today-dot" />}
        {item.count > 0 && (
          <View
            className={cn(
              "h-5.5 min-w-6 items-center justify-center rounded-full px-1.5",
              item.isSelected ? "bg-accent/25" : "bg-default",
            )}
          >
            <AppText className="text-reading text-xs font-medium">{item.count}</AppText>
          </View>
        )}
      </Pressable>
    </>
  );
}
