import { Ionicons } from "@expo/vector-icons";
import type { Href } from "expo-router";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Surface, Tabs, useThemeColor } from "heroui-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { AnimeCard } from "../../components/anime/AnimeCard";
import { AppText } from "../../components/app-text";
import { useAppTheme } from "../../contexts/app-theme-context";
import {
  useAnimeList,
  type AnimeTab,
} from "../../features/animes/use-anime-list";
import { useMutateAnime } from "../../features/animes/use-mutate-anime";
import { incrementalSync } from "../../features/sync/use-initial-sync";
import { useWebSocket } from "../../features/ws/use-websocket";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime";

const TAB_OPTIONS: { value: AnimeTab; label: string }[] = [
  { value: "viendo", label: "Viendo" },
  { value: "estrenos", label: "Estrenos" },
  { value: "todos", label: "Todos" },
];

function EmptyState({ tab }: { tab: AnimeTab }) {
  const icons: Record<AnimeTab, keyof typeof Ionicons.glyphMap> = {
    viendo: "play-circle-outline",
    estrenos: "sparkles-outline",
    todos: "film-outline",
  };
  const messages: Record<AnimeTab, string> = {
    viendo: "No tenés animes en progreso.",
    estrenos: "No hay estrenos disponibles.",
    todos: "No hay animes cargados todavía.",
  };
  const hints: Record<AnimeTab, string> = {
    viendo: "Los animes que estés viendo aparecerán acá.",
    estrenos: "Los estrenos se sincronizan desde el Bridge.",
    todos: "Conectá el Bridge para sincronizar tu lista.",
  };

  return (
    <View className="flex-1 items-center justify-center px-6 py-20">
      <Surface
        variant="secondary"
        className="items-center rounded-2xl px-8 py-10 w-full"
      >
        <Ionicons name={icons[tab]} size={56} color="#9ca3af" />
        <AppText className="text-foreground text-lg font-semibold mt-4 text-center">
          {messages[tab]}
        </AppText>
        <AppText className="text-muted text-sm mt-2 text-center">
          {hints[tab]}
        </AppText>
      </Surface>
    </View>
  );
}

export default function AnimeListScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<AnimeTab>("viendo");
  const { data: animes } = useAnimeList(tab);
  const { capPlus, capMinus } = useMutateAnime();
  const { isDark } = useAppTheme();
  const rawDb = useOptionalSQLiteContext();
  const [themeColorForeground] = useThemeColor(["foreground"]);

  const handleSyncRequired = useCallback(() => {
    if (!rawDb) return;
    void incrementalSync(rawDb, 0);
  }, [rawDb]);

  useWebSocket({ onSyncRequired: handleSyncRequired });

  const handleCapPlus = useCallback(
    (animeId: string) => {
      void capPlus(animeId);
    },
    [capPlus],
  );

  const handleCapMinus = useCallback(
    (animeId: string) => {
      void capMinus(animeId);
    },
    [capMinus],
  );

  return (
    <View className="flex-1 bg-background min-w-[320px]">
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir configuración"
              onPress={() => router.push("/(tabs)/settings" as Href)}
              hitSlop={12}
            >
              <Ionicons
                name="settings-outline"
                size={22}
                color={themeColorForeground}
              />
            </Pressable>
          ),
        }}
      />
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
          renderItem={({ item }) => (
            <AnimeCard
              anime={item}
              onCapPlus={() => handleCapPlus(item._id)}
              onCapMinus={() => handleCapMinus(item._id)}
            />
          )}
          contentContainerClassName="px-4 pt-2 pb-10"
          showsVerticalScrollIndicator={false}
        />
      )}
      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  );
}
