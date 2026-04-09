import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button, Card, Separator, Surface } from 'heroui-native';
import { View } from 'react-native';
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
      <View className="flex-1 items-center justify-center py-12">
        <Card className="w-full">
          <Card.Body className="items-center gap-4 p-6">
            <Surface variant="secondary" className="rounded-full p-4">
              <Ionicons name="server-outline" size={28} color="#6366f1" />
            </Surface>

            <View className="items-center gap-1">
              <AppText className="text-foreground text-3xl font-bold">
                {animeCount}
              </AppText>
              <AppText className="text-muted text-sm">
                Animes en SQLite
              </AppText>
            </View>

            <Separator className="w-full" />

            <AppText className="text-muted text-xs text-center">
              Tracer bullet — pantalla de diagnóstico
            </AppText>

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-2"
              onPress={() => {
                void insertDummyAnime(rawDb);
              }}
            >
              <Button.Label>Insert Dummy Anime</Button.Label>
            </Button>
          </Card.Body>
        </Card>
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ScreenScrollView>
  );
}
