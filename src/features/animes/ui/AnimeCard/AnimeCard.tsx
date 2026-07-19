import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Button, Card, Chip, cn } from "heroui-native";
import { Pressable, View } from "react-native";
import { AppText } from "../../../../components/app-text";
import { CHIP_TONE_COLOR_MAP } from "./anime-card.constants";
import type { AnimeCardProps } from "./anime-card.types";
import { useAnimeCard } from "./use-anime-card";

/** Renders the anime card interface. */
export function AnimeCard(props: Readonly<AnimeCardProps>) {
  const { anime } = props;
  const {
    isMutationLocked,
    disableDecrease,
    disableIncrease,
    stateChip,
    seasonStatus,
    restantesShown,
    restantesLabel,
    toggleRestantesShown,
    handleCapMinusPress,
    handleCapPlusPress,
    handleStateBadgePress,
    handleCapPlusLongPress,
    handleCapMinusLongPress,
    handleOpenSeasonRatingSheet,
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

        <View className="flex-1 flex-row items-start gap-2 p-0.5">
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

            {seasonStatus ? (
              <View className="mt-2 gap-1">
                <Chip
                  color={seasonStatus.tone === "warning" ? "warning" : "accent"}
                  size="sm"
                  variant="secondary"
                >
                  <Chip.Label>{seasonStatus.label}</Chip.Label>
                </Chip>
                <AppText className="text-muted text-xs">
                  {seasonStatus.description}
                </AppText>
              </View>
            ) : null}
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
        {seasonStatus?.showRatingCta ? (
          <Button
            accessibilityLabel="Abrir calificación de temporada"
            onPress={handleOpenSeasonRatingSheet}
            size="sm"
            variant="secondary"
            className="mr-4"
          >
            <Button.Label>Temporada</Button.Label>
          </Button>
        ) : null}
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
              isIconOnly
              onPress={handleCapMinusPress}
              onLongPress={handleCapMinusLongPress}
              isDisabled={disableDecrease}
              className={cn('size-10', disableDecrease ? "opacity-40" : undefined)}
            >
              <Ionicons name="remove" size={22} color="#ffffff" />
            </Button>
            <AppText className="text-foreground min-w-9 text-center text-base font-semibold tabular-nums">
              {anime.nrocapvisto}
            </AppText>
            <Button
              accessibilityLabel="Increase chapter"
              variant="primary"
              isIconOnly
              onPress={handleCapPlusPress}
              onLongPress={handleCapPlusLongPress}
              isDisabled={disableIncrease}
              className={cn('size-10', disableIncrease ? "opacity-40" : undefined)}
            >
              <Ionicons name="add" size={22} color="#ffffff" />
            </Button>
          </>
        )}
      </View>
    </Card>
  );
}
