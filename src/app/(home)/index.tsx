import { StatusBar } from 'expo-status-bar';
import { Button, Card } from 'heroui-native';
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
      <View className="flex-1 items-center justify-center py-20">
        <Card className="w-full p-6 items-center">
          <Card.Body className="items-center gap-3">
            <AppText className="text-foreground text-2xl font-bold">
              Animes en SQLite: {animeCount}
            </AppText>
            <AppText className="text-muted text-base text-center">
              Tracer bullet SQLite activo
            </AppText>
            <Button
              variant="primary"
              size="lg"
              className="mt-4"
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
