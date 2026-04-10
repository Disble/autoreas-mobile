import { Slot } from 'expo-router';
import { HeroUINativeProvider } from 'heroui-native';
import { Suspense } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SQLiteUnavailableScreen } from '../../../../components/sqlite-unavailable-screen';
import { AppThemeProvider } from '../../../../contexts/app-theme-context';
import type { AppRootLayoutProps } from './app-root-layout.types';
import { useAppRootLayout } from './use-app-root-layout';

export function AppRootLayout(props: AppRootLayoutProps) {
  const {
    SQLiteProvider,
    bootState,
    contentWrapper,
    databaseName,
    fontsLoaded,
    handleDatabaseInit,
    sqliteOptions,
  } = useAppRootLayout(props);

  if (!fontsLoaded) {
    return null;
  }

  if (!SQLiteProvider) {
    return <SQLiteUnavailableScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardProvider>
          <Suspense fallback={null}>
            <SQLiteProvider
              databaseName={databaseName}
              onInit={handleDatabaseInit}
              options={sqliteOptions}
              useSuspense
            >
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
                  {bootState.initialized ? <Slot /> : null}
                </HeroUINativeProvider>
              </AppThemeProvider>
            </SQLiteProvider>
          </Suspense>
        </KeyboardProvider>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
