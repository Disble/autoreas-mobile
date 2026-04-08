import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Slot, type Href, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { HeroUINativeProvider } from 'heroui-native';
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  KeyboardAvoidingView,
  KeyboardProvider,
} from 'react-native-keyboard-controller';
import '../../global.css';
import { SQLiteUnavailableScreen } from '../components/sqlite-unavailable-screen';
import {
  DATABASE_NAME,
  getBridgeConfigSnapshot,
  runMigrations,
} from '../infrastructure/db/client';
import { getSQLiteProvider } from '../infrastructure/db/native-runtime';
import { AppThemeProvider } from '../contexts/app-theme-context';

type BootTarget = Href;

interface BootState {
  initialized: boolean;
  target: BootTarget | null;
}

const BootStateContext = createContext<BootState>({
  initialized: false,
  target: null,
});

SplashScreen.setOptions({
  duration: 300,
  fade: true,
});

void SplashScreen.preventAutoHideAsync();

function useBootState() {
  return useContext(BootStateContext);
}

function BootRouter() {
  const router = useRouter();
  const { initialized, target } = useBootState();
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (!initialized || !target || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    router.replace(target);
    void SplashScreen.hideAsync();
  }, [initialized, router, target]);

  if (!initialized) {
    return null;
  }

  return <Slot />;
}

/**
 * Component that wraps app content inside KeyboardProvider
 * Contains the contentWrapper and HeroUINativeProvider configuration
 */
function AppContent({ bootState }: { bootState: BootState }) {
  const contentWrapper = useCallback(
    (children: React.ReactNode) => (
      <KeyboardAvoidingView
        pointerEvents="box-none"
        behavior="padding"
        keyboardVerticalOffset={12}
        className="flex-1"
      >
        {children}
      </KeyboardAvoidingView>
    ),
    []
  );

  return (
    <BootStateContext.Provider value={bootState}>
      <AppThemeProvider>
        <HeroUINativeProvider
          config={{
            textProps: {
              maxFontSizeMultiplier: 2,
            },
            toast: {
              contentWrapper,
            },
          }}
        >
          <BootRouter />
        </HeroUINativeProvider>
      </AppThemeProvider>
    </BootStateContext.Provider>
  );
}

function MissingSQLiteRoot() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return <SQLiteUnavailableScreen />;
}

export default function Layout() {
  const fonts = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [bootState, setBootState] = useState<BootState>({
    initialized: false,
    target: null,
  });
  const SQLiteProvider = getSQLiteProvider();

  const initDatabase = useCallback(async (rawDb: SQLiteDatabase) => {
    await rawDb.execAsync('PRAGMA journal_mode = WAL;');
    await runMigrations(rawDb);

    const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

    setBootState({
      initialized: true,
      target: bridgeConfig?.deviceId ? ('/(tabs)' as Href) : ('/setup' as Href),
    });
  }, []);

  const sqliteOptions = useMemo(
    () => ({ enableChangeListener: true }),
    []
  );

  if (!fonts) {
    return null;
  }

  if (!SQLiteProvider) {
    return <MissingSQLiteRoot />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <Suspense fallback={null}>
          <SQLiteProvider
            databaseName={DATABASE_NAME}
            onInit={initDatabase}
            options={sqliteOptions}
            useSuspense
          >
            <AppContent bootState={bootState} />
          </SQLiteProvider>
        </Suspense>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
