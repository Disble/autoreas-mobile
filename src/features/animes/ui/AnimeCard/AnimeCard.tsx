import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chip, Separator } from 'heroui-native';
import { AppText } from '../../../../components/app-text';
import { useAnimeCard } from './use-anime-card';
import type { AnimeCardProps } from './anime-card.types';

export function AnimeCard(props: AnimeCardProps) {
  const { anime, onCapMinus, onCapPlus } = props;
  const {
    progress,
    isCompleted,
    disableDecrease,
    disableIncrease,
    daysList,
    genresList,
  } = useAnimeCard(props);

  return (
    <Card className="mb-3 overflow-hidden">
      <Card.Body className="flex-row p-0">
        <Image
          source={{ uri: anime.portada || 'https://via.placeholder.com/100x150' }}
          className="h-[130px] w-[90px]"
          contentFit="cover"
        />

        <View className="flex-1 justify-between p-3">
          <View>
            <AppText
              className="text-foreground text-base font-bold leading-tight"
              numberOfLines={2}
            >
              {anime.nombre}
            </AppText>

            <View className="mt-1.5 flex-row items-center gap-2">
              <AppText className="text-muted text-sm">
                Cap. {anime.nrocapvisto}
                {anime.totalcap ? ` / ${anime.totalcap}` : ''}
              </AppText>
              {isCompleted && (
                <Chip size="sm" variant="secondary" color="success">
                  <Chip.Label>Completo</Chip.Label>
                </Chip>
              )}
            </View>

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
                  <Chip key={d.dia} size="sm" variant="secondary" color="accent">
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

      <View className="flex-row items-center justify-end gap-2 px-3 pb-2">
        <Button
          accessibilityLabel="Decrease chapter"
          variant="danger-soft"
          size="sm"
          isIconOnly
          onPress={onCapMinus}
          isDisabled={disableDecrease}
        >
          <Ionicons name="remove" size={18} />
        </Button>
        <AppText className="text-foreground min-w-[28px] text-center text-sm font-semibold">
          {anime.nrocapvisto}
        </AppText>
        <Button
          accessibilityLabel="Increase chapter"
          variant="secondary"
          size="sm"
          isIconOnly
          onPress={onCapPlus}
          isDisabled={disableIncrease}
          className="bg-success/20"
        >
          <Ionicons name="add" size={18} />
        </Button>
      </View>
    </Card>
  );
}
