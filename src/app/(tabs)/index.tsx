import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'heroui-native';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { AnimeCard } from '../../components/anime/AnimeCard';
import { AppText } from '../../components/app-text';
import { useAppTheme } from '../../contexts/app-theme-context';
import { useAnimeList, type AnimeTab } from '../../features/animes/use-anime-list';
import { useMutateAnime } from '../../features/animes/use-mutate-anime';
import { incrementalSync } from '../../features/sync/use-initial-sync';
import { useWebSocket } from '../../features/ws/use-websocket';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import type { Anime } from '../../infrastructure/validation/anime-schema';

const TAB_OPTIONS: { value: AnimeTab; label: string }[] = [
  { value: 'viendo', label: 'Viendo' },
  { value: 'estrenos', label: 'Estrenos' },
  { value: 'todos', label: 'Todos' },
];

function EmptyState({ tab }: { tab: AnimeTab }) {
  const messages: Record<AnimeTab, string> = {
    viendo: 'No tenés animes en progreso.',
    estrenos: 'No hay estrenos disponibles.',
    todos: 'No hay animes cargados todavía.',
  };

  return (
    <View className="flex-1 items-center justify-center py-20">
      <Ionicons name="film-outline" size={48} className="text-muted mb-4" />
      <AppText className="text-muted text-base text-center">{messages[tab]}</AppText>
    </View>
  );
}

export default function AnimeListScreen() {
  const [tab, setTab] = useState<AnimeTab>('viendo');
  const { data: animes } = useAnimeList(tab);
  const { capPlus, capMinus } = useMutateAnime();
  const { isDark } = useAppTheme();
  const rawDb = useOptionalSQLiteContext();

  const handleSyncRequired = useCallback(() => {
    if (!rawDb) return;
    // Sync incremental desde 0 — en el futuro se puede persistir el last_changelog_id
    void incrementalSync(rawDb, 0);
  }, [rawDb]);

  useWebSocket({ onSyncRequired: handleSyncRequired });

  const handleCapPlus = (anime: Anime) => {
    void capPlus(anime);
  };

  const handleCapMinus = (anime: Anime) => {
    void capMinus(anime);
  };

  return (
    <View className="flex-1 bg-background" style={styles.container}>
      <View className="px-4 pt-4 pb-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as AnimeTab)}>
          <Tabs.List className="w-full">
            <Tabs.Indicator />
            {TAB_OPTIONS.map((t) => (
              <Tabs.Trigger key={t.value} value={t.value}>
                <Tabs.Label>{t.label}</Tabs.Label>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </View>

      {animes.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <FlatList
          data={animes}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => {
            const diasArray = item.dias ? JSON.parse(item.dias) : [];
            const generosArray = item.generos ? JSON.parse(item.generos) : [];
            const anime: Anime = {
              ...item,
              dias: diasArray,
              generos: generosArray,
            } as Anime;

            return (
              <AnimeCard
                anime={anime}
                onCapPlus={handleCapPlus}
                onCapMinus={handleCapMinus}
              />
            );
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
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
