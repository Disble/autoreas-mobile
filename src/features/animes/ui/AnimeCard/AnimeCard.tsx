import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Button, Card, Chip } from "heroui-native";
import React from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../../../components/app-text";
import { CHIP_TONE_COLOR_MAP } from "./anime-card.helpers";
import type { AnimeCardProps } from "./anime-card.types";
import { useAnimeCard } from "./use-anime-card";

export function AnimeCard(props: AnimeCardProps) {
  const { anime } = props;
  const {
    progress,
    isCompleted,
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    restantesShown,
    restantesLabel,
    dayChipList,
    genresList,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
  } = useAnimeCard(props);

  const hasKnownTotal = anime.totalcap != null && anime.totalcap > 0;

  return (
    <Card className="mb-4">
      <Card.Body className="flex-row p-0">
        <Image
          source={{
            uri: anime.portada || "https://via.placeholder.com/100x150",
          }}
          className="h-[140px] w-[96px] rounded-l-xl"
          contentFit="cover"
        />

        <View className="flex-1 justify-between p-4">
          <View>
            <View className="flex-row items-start justify-between gap-3">
              <AppText
                className="text-foreground flex-1 text-base font-bold leading-tight"
                numberOfLines={2}
              >
                {anime.nombre}
              </AppText>
              {stateChip.isDefault ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cambiar estado del anime"
                  onPress={handleStateBadgePress}
                  hitSlop={10}
                  className="h-7 w-7 items-center justify-center rounded-full"
                >
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={18}
                    color="#9ca3af"
                  />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cambiar estado: ${stateChip.label}`}
                  onPress={handleStateBadgePress}
                  hitSlop={8}
                >
                  <Chip
                    size="sm"
                    variant="secondary"
                    color={CHIP_TONE_COLOR_MAP[stateChip.tone]}
                  >
                    <Chip.Label>{stateChip.label}</Chip.Label>
                  </Chip>
                </Pressable>
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alternar episodios restantes"
              onPress={toggleRestantesShown}
              hitSlop={8}
              className="mt-2 self-start"
            >
              <AppText className="text-muted text-[13px]">
                {restantesShown && restantesLabel
                  ? restantesLabel
                  : hasKnownTotal
                    ? `Cap. ${anime.nrocapvisto} / ${anime.totalcap}`
                    : `Cap. ${anime.nrocapvisto} · en emisión`}
              </AppText>
            </Pressable>

            {progress !== null && !isCompleted ? (
              <View className="mt-2.5">
                <View className="bg-surface-tertiary/60 h-1 overflow-hidden rounded-full">
                  <View
                    className="bg-accent h-full rounded-full"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </View>
              </View>
            ) : !hasKnownTotal ? (
              <View className="mt-2.5">
                <View className="bg-surface-tertiary/30 h-1 overflow-hidden rounded-full" />
              </View>
            ) : null}
          </View>

          {(genresList.length > 0 || dayChipList.length > 0) && (
            <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
              {dayChipList.map((d) => (
                <View
                  key={`day-${d.key}`}
                  className="bg-accent/15 h-6 w-6 items-center justify-center rounded-md"
                >
                  <AppText className="text-accent text-[11px] font-bold">
                    {d.label}
                  </AppText>
                </View>
              ))}
              {genresList.slice(0, 2).map((g: string) => (
                <Chip key={g} size="sm" variant="tertiary">
                  <Chip.Label>{g}</Chip.Label>
                </Chip>
              ))}
              {genresList.length > 2 && (
                <AppText className="text-muted/80 text-[11px]">
                  +{genresList.length - 2}
                </AppText>
              )}
            </View>
          )}
        </View>
      </Card.Body>

      <View className="flex-row items-center justify-end gap-3 px-4 pb-3 pt-1">
        {isMutationLocked ? (
          <Button
            accessibilityLabel="Reanudar anime"
            variant="secondary"
            size="lg"
            onPress={handleStateBadgePress}
          >
            <Ionicons name="play" size={18} />
            <Button.Label>Reanudar</Button.Label>
          </Button>
        ) : (
          <>
            <Button
              accessibilityLabel="Decrease chapter"
              variant="danger-soft"
              size="lg"
              isIconOnly
              onPress={handleCapMinusPress}
              onLongPress={handleCapMinusLongPress}
              isDisabled={disableDecrease}
            >
              <Ionicons name="remove" size={22} />
            </Button>
            <AppText className="text-foreground min-w-[52px] text-center text-lg font-semibold tabular-nums">
              {anime.nrocapvisto}
            </AppText>
            <Button
              accessibilityLabel="Increase chapter"
              variant="secondary"
              size="lg"
              isIconOnly
              onPress={handleCapPlusPress}
              onLongPress={handleCapPlusLongPress}
              isDisabled={disableIncrease}
            >
              <Ionicons name="add" size={22} />
            </Button>
          </>
        )}
      </View>
    </Card>
  );
}
