import { Chip, cn } from "heroui-native";
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "../../../../components/app-text";
import type {
  AnimeFilterRailItem,
  AnimeFilterRailProps,
  VerticalRailRowProps,
} from "./anime-filter-rail.types";
import { useAnimeFilterRail } from "./use-anime-filter-rail";

export function AnimeFilterRail(props: AnimeFilterRailProps) {
  const { items, orientation, handleSelect } = useAnimeFilterRail(props);

  if (orientation === "horizontal") {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-none w-full"
        contentContainerClassName="flex-row items-center gap-2 px-4 py-2"
      >
        {items.map((item) => (
          <Chip
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: item.isSelected }}
            accessibilityLabel={`${item.label}${item.count > 0 ? `, ${item.count}` : ""}`}
            onPress={() => handleSelect(item.value)}
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
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerClassName="gap-1 px-3 pb-6 pt-3"
    >
      {items.map((item) => (
        <VerticalRailRow
          key={item.value}
          item={item}
          onSelect={handleSelect}
        />
      ))}
    </ScrollView>
  );
}

export function VerticalRailRow({ item, onSelect }: VerticalRailRowProps) {
  const showSection = item.isFirstPseudoDay;
  const hasBacklog = item.count > 0;

  return (
    <>
      {showSection && (
        <View className="mb-1 mt-4 px-1">
          <AppText className="text-muted/70 text-[11px] font-semibold uppercase tracking-wider">
            Filtros
          </AppText>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: item.isSelected }}
        accessibilityLabel={`${item.label}${hasBacklog ? `, ${item.count}` : ""}`}
        onPress={() => onSelect(item.value)}
        hitSlop={8}
        className={cn(
          "flex-row items-center overflow-hidden rounded-lg",
          item.isSelected ? "bg-accent/10" : "bg-transparent",
        )}
      >
        <View
          className={cn(
            "h-9 w-1 rounded-r-full",
            item.isSelected ? "bg-accent" : "bg-transparent",
          )}
        />
        <View className="flex-1 flex-row items-center gap-2 py-2.5 pl-3 pr-2">
          {item.isToday && !item.isSelected && (
            <View className="bg-accent h-1.5 w-1.5 rounded-full" />
          )}
          <AppText
            className={cn(
              "flex-1 text-base",
              item.isSelected
                ? "text-accent font-semibold"
                : "text-foreground",
            )}
            numberOfLines={1}
          >
            {item.label}
          </AppText>
          {hasBacklog ? (
            <View
              className={cn(
                "min-w-[22px] items-center rounded-full px-1.5 py-0.5",
                item.isSelected ? "bg-accent/20" : "bg-surface-tertiary",
              )}
            >
              <AppText
                className={cn(
                  "text-[11px] font-semibold",
                  item.isSelected ? "text-accent" : "text-muted",
                )}
              >
                {item.count}
              </AppText>
            </View>
          ) : (
            <AppText className="text-muted/40 text-[11px] font-semibold">
              —
            </AppText>
          )}
        </View>
      </Pressable>
    </>
  );
}
