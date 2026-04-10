import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef } from 'react';
import { useDbBootstrap } from '../../use-db-bootstrap';
import { renderKeyboardAvoidingWrapper } from './app-root-layout.helpers';
import type {
  AppRootLayoutProps,
  AppRootLayoutViewModel,
} from './app-root-layout.types';

export function useAppRootLayout(
  _props: AppRootLayoutProps,
): AppRootLayoutViewModel {
  // 1. Refs
  const hasNavigatedRef = useRef(false);

  // 2. State

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // 4. Queries/Mutations
  const { bootState, databaseName, handleDatabaseInit, sqliteOptions, sqliteProvider } =
    useDbBootstrap();

  // 5. Derived State (useMemo)
  const SQLiteProvider = sqliteProvider;
  const isBootstrapped = bootState.initialized;

  // 6. Callbacks (useCallback calling pure helpers)
  const contentWrapper = useCallback(renderKeyboardAvoidingWrapper, []);

  // 7. Effects
  useEffect(() => {
    SplashScreen.setOptions({
      duration: 300,
      fade: true,
    });

    void SplashScreen.preventAutoHideAsync();
  }, []);

  useEffect(() => {
    if (!fontsLoaded || SQLiteProvider || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    void SplashScreen.hideAsync();
  }, [SQLiteProvider, fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded || !bootState.initialized || !bootState.target || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    router.replace(bootState.target);
    void SplashScreen.hideAsync();
  }, [bootState.initialized, bootState.target, fontsLoaded, router]);

  return {
    SQLiteProvider,
    bootState,
    contentWrapper,
    databaseName,
    fontsLoaded,
    handleDatabaseInit,
    isBootstrapped,
    sqliteOptions,
  };
}
