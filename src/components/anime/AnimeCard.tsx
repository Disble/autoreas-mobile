import { Image } from 'expo-image';
import { View, Pressable, StyleSheet } from 'react-native';
import { AppText } from '../app-text';
import { type Anime } from '../../infrastructure/validation/anime-schema';

interface AnimeCardProps {
  anime: Anime;
  onCapPlus: (anime: Anime) => void;
  onCapMinus: (anime: Anime) => void;
}

export function AnimeCard({ anime, onCapPlus, onCapMinus }: AnimeCardProps) {
  const { nombre, nrocapvisto, totalcap, generos, dias, portada } = anime;

  const daysList = dias || [];
  const genresList = generos || [];

  return (
    <View style={styles.card} className="bg-background rounded-xl p-3 mb-4 shadow-sm min-w-[320px] flex-row">
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
          <AppText className="text-muted text-sm mt-1">
            Capítulo: {nrocapvisto} {totalcap ? `/ ${totalcap}` : ''}
          </AppText>

          <View className="flex-row flex-wrap mt-2 gap-1">
            {genresList.map((g: string) => (
              <View key={g} className="bg-foreground/10 px-2 py-1 rounded-md">
                <AppText className="text-xs text-foreground">{g}</AppText>
              </View>
            ))}
            {daysList.map((d: any) => (
              <View key={d.dia || String(d)} className="bg-blue-500/10 px-2 py-1 rounded-md">
                <AppText className="text-xs text-blue-600">{d.dia || d}</AppText>
              </View>
            ))}
          </View>
        </View>

        <View className="flex-row mt-3 items-center justify-end gap-2">
          <Pressable
            accessibilityLabel="Decrease chapter"
            className="bg-red-500/20 px-4 py-2 rounded-lg flex-row items-center justify-center min-w-[44px]"
            onPress={() => onCapMinus(anime)}
            disabled={nrocapvisto <= 0}
          >
            <AppText className="text-red-600 font-bold text-lg">-</AppText>
          </Pressable>
          <Pressable
            accessibilityLabel="Increase chapter"
            className="bg-green-500/20 px-4 py-2 rounded-lg flex-row items-center justify-center min-w-[44px]"
            onPress={() => onCapPlus(anime)}
            disabled={totalcap != null && nrocapvisto >= totalcap}
          >
            <AppText className="text-green-600 font-bold text-lg">+</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 320,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  cover: {
    width: 80,
    height: 120,
    backgroundColor: '#e1e4e8',
  },
});
