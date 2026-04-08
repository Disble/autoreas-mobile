import { StatusBar } from 'expo-status-bar';
import { Pressable, View } from 'react-native';
import { AppText } from '../../components/app-text';
import { ScreenScrollView } from '../../components/screen-scroll-view';
import { SQLiteUnavailableScreen } from '../../components/sqlite-unavailable-screen';
import { useAppTheme } from '../../contexts/app-theme-context';
import { createDrizzleDb, insertDummyAnime } from '../../infrastructure/db/client';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { animes } from '../../infrastructure/db/schema';

export default function HomeScreen() {
  const { isDark } = useAppTheme();
  const rawDb = useOptionalSQLiteContext();
  const db = rawDb ? createDrizzleDb(rawDb) : null;
  const { data } = useOptionalLiveQuery(db?.select().from(animes) ?? null, []);

  if (!rawDb) {
    return <SQLiteUnavailableScreen />;
  }

  const animeCount = data.length;

  return (
    <ScreenScrollView>
      <View className="flex-1 items-center justify-center py-20">
        <AppText className="text-foreground text-2xl font-bold">
          Animes en SQLite: {animeCount}
        </AppText>
        <AppText className="text-muted text-base text-center mt-4">
          Tracer bullet SQLite activo
        </AppText>
        <Pressable
          accessibilityRole="button"
          className="mt-6 rounded-xl bg-foreground px-5 py-3"
          onPress={() => {
            void insertDummyAnime(rawDb);
          }}
        >
          <AppText className="text-background font-semibold">
            Insert Dummy Anime
          </AppText>
        </Pressable>
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ScreenScrollView>
  );
}
