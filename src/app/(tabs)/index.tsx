import { useState } from 'react';
import { View, FlatList, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppText } from '../../components/app-text';
import { AnimeCard } from '../../components/anime/AnimeCard';
import { useAnimeList, type AnimeTab } from '../../features/animes/use-anime-list';
import { useMutateAnime } from '../../features/animes/use-mutate-anime';
import { useAppTheme } from '../../contexts/app-theme-context';
import type { Anime } from '../../infrastructure/validation/anime-schema';

export default function AnimeListScreen() {
  const [tab, setTab] = useState<AnimeTab>('viendo');
  const { data: animes } = useAnimeList(tab);
  const { capPlus, capMinus } = useMutateAnime();
  const { isDark } = useAppTheme();

  const handleCapPlus = (anime: Anime) => {
    void capPlus(anime);
  };

  const handleCapMinus = (anime: Anime) => {
    void capMinus(anime);
  };

  return (
    <View className="flex-1 bg-background" style={styles.container}>
      <View className="flex-row items-center justify-around py-4 border-b border-muted/20">
        <TabButton title="Viendo" active={tab === 'viendo'} onPress={() => setTab('viendo')} />
        <TabButton title="Estrenos" active={tab === 'estrenos'} onPress={() => setTab('estrenos')} />
        <TabButton title="Todos" active={tab === 'todos'} onPress={() => setTab('todos')} />
      </View>

      <FlatList
        data={animes}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => {
          // Parse to Anime type since Drizzle returns string|null for JSON fields
          const diasArray = item.dias ? JSON.parse(item.dias) : [];
          const generosArray = item.generos ? JSON.parse(item.generos) : [];
          const anime: Anime = {
            ...item,
            dias: diasArray,
            generos: generosArray
          } as Anime;

          return <AnimeCard anime={anime} onCapPlus={handleCapPlus} onCapMinus={handleCapMinus} />
        }}
        contentContainerStyle={styles.listContent}
        showsHorizontalScrollIndicator={false}
      />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  );
}

function TabButton({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 py-2 rounded-full ${active ? 'bg-foreground' : 'bg-transparent'}`}
    >
      <AppText className={`${active ? 'text-background font-bold' : 'text-foreground'}`}>
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minWidth: 320,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
});
