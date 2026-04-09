import { Image } from 'expo-image';
import { Button, Card, Chip } from 'heroui-native';
import { StyleSheet, View } from 'react-native';
import { type Anime } from '../../infrastructure/validation/anime-schema';
import { AppText } from '../app-text';

interface AnimeCardProps {
  anime: Anime;
  onCapPlus: (anime: Anime) => void;
  onCapMinus: (anime: Anime) => void;
}

export function AnimeCard({ anime, onCapPlus, onCapMinus }: AnimeCardProps) {
  const { nombre, nrocapvisto, totalcap, generos, dias, portada } = anime;

  const daysList = dias || [];
  const genresList = generos || [];
  const progress =
    totalcap && totalcap > 0
      ? Math.round((nrocapvisto / totalcap) * 100)
      : null;

  return (
    <Card className="mb-4 min-w-[320px]">
      <Card.Body className="flex-row p-3">
        <Image
          source={{ uri: portada || 'https://via.placeholder.com/100x150' }}
          style={styles.cover}
          className="rounded-lg mr-3"
        />

        <View className="flex-1 flex-col justify-between">
          <View>
            <AppText className="text-foreground text-lg font-bold" numberOfLines={2}>
              {nombre}
            </AppText>

            <View className="flex-row items-center mt-1 gap-2">
              <AppText className="text-muted text-sm">
                Capítulo: {nrocapvisto} {totalcap ? `/ ${totalcap}` : ''}
              </AppText>
              {progress !== null && (
                <Chip size="sm" variant="secondary" color={progress >= 100 ? 'success' : 'accent'}>
                  <Chip.Label>{progress}%</Chip.Label>
                </Chip>
              )}
            </View>

            <View className="flex-row flex-wrap mt-2 gap-1">
              {genresList.map((g: string) => (
                <Chip key={g} size="sm" variant="tertiary">
                  <Chip.Label>{g}</Chip.Label>
                </Chip>
              ))}
              {daysList.map((d: any) => (
                <Chip key={d.dia || String(d)} size="sm" variant="secondary" color="accent">
                  <Chip.Label>{d.dia || d}</Chip.Label>
                </Chip>
              ))}
            </View>
          </View>

          <View className="flex-row mt-3 items-center justify-end gap-2">
            <Button
              accessibilityLabel="Decrease chapter"
              variant="danger-soft"
              size="sm"
              isIconOnly
              onPress={() => onCapMinus(anime)}
              isDisabled={nrocapvisto <= 0}
            >
              <AppText className="text-danger font-bold text-lg">-</AppText>
            </Button>
            <Button
              accessibilityLabel="Increase chapter"
              variant="secondary"
              size="sm"
              isIconOnly
              onPress={() => onCapPlus(anime)}
              isDisabled={totalcap != null && nrocapvisto >= totalcap}
              className="bg-success/20"
            >
              <AppText className="text-success font-bold text-lg">+</AppText>
            </Button>
          </View>
        </View>
      </Card.Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  cover: {
    width: 80,
    height: 120,
    backgroundColor: '#e1e4e8',
  },
});
