import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Button, Card, Chip, Separator } from "heroui-native";
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
    daysList,
    genresList,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
  } = useAnimeCard(props);

  return (
    <Card className="mb-3">
      <Card.Body className="flex-row p-0">
        <Image
          source={{
            uri: anime.portada || "https://via.placeholder.com/100x150",
          }}
          className="h-[130px] w-[90px]"
          contentFit="cover"
        />

        <View className="flex-1 justify-between p-3">
          <View>
            <View className="flex-row items-start justify-between gap-2">
              <AppText
                className="text-foreground flex-1 text-base font-bold leading-tight"
                numberOfLines={2}
              >
                {anime.nombre}
              </AppText>
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
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alternar episodios restantes"
              onPress={toggleRestantesShown}
              hitSlop={8}
              className="mt-1.5 self-start"
            >
              <AppText className="text-muted text-sm">
                {restantesShown && restantesLabel
                  ? restantesLabel
                  : `Cap. ${anime.nrocapvisto}${anime.totalcap ? ` / ${anime.totalcap}` : ""}`}
              </AppText>
            </Pressable>

            {progress !== null && !isCompleted && (
              <View className="mt-2">
                <View className="bg-surface-tertiary h-1.5 overflow-hidden rounded-full">
                  <View
                    className="bg-accent h-full rounded-full"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </View>
              </View>
            )}
          </View>

          {(genresList.length > 0 || daysList.length > 0) && (
            <>
              <Separator className="my-2" />
              <View className="flex-row flex-wrap gap-1">
                {daysList.map((d) => (
                  <Chip
                    key={d.dia}
                    size="sm"
                    variant="secondary"
                    color="accent"
                  >
                    <Chip.Label>{d.dia}</Chip.Label>
                  </Chip>
                ))}
                {genresList.slice(0, 3).map((g: string) => (
                  <Chip key={g} size="sm" variant="tertiary">
                    <Chip.Label>{g}</Chip.Label>
                  </Chip>
                ))}
                {genresList.length > 3 && (
                  <Chip size="sm" variant="tertiary">
                    <Chip.Label>+{genresList.length - 3}</Chip.Label>
                  </Chip>
                )}
              </View>
            </>
          )}
        </View>
      </Card.Body>

      <View className="flex-row items-center justify-end gap-3 px-3 pb-3">
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
            <AppText className="text-foreground min-w-[32px] text-center text-base font-semibold">
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
