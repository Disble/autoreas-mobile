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
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
  } = useAnimeCard(props);

  const chaptersLabel =
    anime.nrocapvisto === 1
      ? "1 capítulo"
      : `${anime.nrocapvisto} capítulos`;
  const defaultMeta = `${chaptersLabel} · ${stateChip.label}`;
  const metaLabel =
    restantesShown && restantesLabel ? restantesLabel : defaultMeta;

  return (
    <Card className="mb-3">
      <Card.Body className="flex-row p-0">
        <Image
          source={{
            uri: anime.portada || "https://via.placeholder.com/100x150",
          }}
          className="h-24 w-16 rounded-l-xl"
          contentFit="cover"
        />

        <View className="flex-1 flex-row items-start gap-2 p-3">
          <View className="flex-1">
            <AppText
              className="text-foreground text-sm font-semibold leading-tight"
              numberOfLines={2}
            >
              {anime.nombre}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alternar episodios restantes"
              onPress={toggleRestantesShown}
              hitSlop={8}
              className="mt-1 self-start"
            >
              <AppText className="text-muted text-xs">{metaLabel}</AppText>
            </Pressable>
          </View>

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
      </Card.Body>

      <View className="flex-row items-center justify-end gap-2 px-3 pb-3 pt-1">
        {isMutationLocked ? (
          <Button
            accessibilityLabel="Reanudar anime"
            variant="secondary"
            size="sm"
            onPress={handleStateBadgePress}
          >
            <Ionicons name="play" size={14} />
            <Button.Label>Reanudar</Button.Label>
          </Button>
        ) : (
          <>
            <Button
              accessibilityLabel="Decrease chapter"
              variant="danger"
              size="md"
              isIconOnly
              onPress={handleCapMinusPress}
              onLongPress={handleCapMinusLongPress}
              isDisabled={disableDecrease}
              className={disableDecrease ? "opacity-40" : undefined}
            >
              <Ionicons name="remove" size={18} color="#ffffff" />
            </Button>
            <AppText className="text-foreground min-w-9 text-center text-base font-semibold tabular-nums">
              {anime.nrocapvisto}
            </AppText>
            <Button
              accessibilityLabel="Increase chapter"
              variant="primary"
              size="md"
              isIconOnly
              onPress={handleCapPlusPress}
              onLongPress={handleCapPlusLongPress}
              isDisabled={disableIncrease}
              className={disableIncrease ? "opacity-40" : undefined}
            >
              <Ionicons name="add" size={18} color="#ffffff" />
            </Button>
          </>
        )}
      </View>
    </Card>
  );
}
