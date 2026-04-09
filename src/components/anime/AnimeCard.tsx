import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Button, Card, Chip, Separator } from "heroui-native";
import { View } from "react-native";
import { type Anime } from "../../infrastructure/validation/anime-schema";
import { AppText } from "../app-text";

interface AnimeCardProps {
  anime: Anime;
  onCapPlus: () => void;
  onCapMinus: () => void;
}

export function AnimeCard({ anime, onCapPlus, onCapMinus }: AnimeCardProps) {
  const { nombre, nrocapvisto, totalcap, generos, dias, portada } = anime;

  const daysList = dias || [];
  const genresList = generos || [];
  const progress =
    totalcap && totalcap > 0
      ? Math.round((nrocapvisto / totalcap) * 100)
      : null;
  const isCompleted = progress !== null && progress >= 100;

  return (
    <Card className="mb-3 overflow-hidden">
      <Card.Body className="flex-row p-0">
        <Image
          source={{ uri: portada || "https://via.placeholder.com/100x150" }}
          className="w-[90px] h-[130px]"
          contentFit="cover"
        />

        <View className="flex-1 p-3 justify-between">
          <View>
            <AppText
              className="text-foreground text-base font-bold leading-tight"
              numberOfLines={2}
            >
              {nombre}
            </AppText>

            <View className="flex-row items-center mt-1.5 gap-2">
              <AppText className="text-muted text-sm">
                Cap. {nrocapvisto}
                {totalcap ? ` / ${totalcap}` : ""}
              </AppText>
              {isCompleted && (
                <Chip size="sm" variant="secondary" color="success">
                  <Chip.Label>Completo</Chip.Label>
                </Chip>
              )}
            </View>

            {progress !== null && !isCompleted && (
              <View className="mt-2">
                <View className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                  <View
                    className="h-full rounded-full bg-accent"
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

      <View className="flex-row items-center justify-end px-3 pb-2 gap-2">
        <Button
          accessibilityLabel="Decrease chapter"
          variant="danger-soft"
          size="sm"
          isIconOnly
          onPress={onCapMinus}
          isDisabled={nrocapvisto <= 0}
        >
          <Ionicons name="remove" size={18} />
        </Button>
        <AppText className="text-foreground font-semibold text-sm min-w-[28px] text-center">
          {nrocapvisto}
        </AppText>
        <Button
          accessibilityLabel="Increase chapter"
          variant="secondary"
          size="sm"
          isIconOnly
          onPress={onCapPlus}
          isDisabled={totalcap != null && nrocapvisto >= totalcap}
          className="bg-success/20"
        >
          <Ionicons name="add" size={18} />
        </Button>
      </View>
    </Card>
  );
}
