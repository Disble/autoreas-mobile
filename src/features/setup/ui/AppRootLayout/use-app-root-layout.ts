import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useDbBootstrap } from '../../use-db-bootstrap';
import {
  renderKeyboardAvoidingWrapper,
  resolveAppRootLayoutContent,
  resolveAppRootLayoutRootContent,
  resolveAppRootLayoutScreen,
} from './app-root-layout.helpers';
import type {
  AppRootLayoutProps,
  AppRootLayoutViewModel,
} from './app-root-layout.types';

/** Coordinates app root layout state and actions. */
export function useAppRootLayout(
  _props: AppRootLayoutProps,
): AppRootLayoutViewModel {
  // 1. Refs
  const hasCompletedStartupRef = useRef(false);

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
  const shouldRenderRouteSlot = bootState.initialized && !bootState.failure;
  const startupFailure = bootState.failure;
  const screen = useMemo(
    () =>
      resolveAppRootLayoutScreen({
        fontsLoaded,
        hasSQLiteProvider: Boolean(SQLiteProvider),
        shouldRenderRouteSlot,
        startupFailure,
      }),
    [SQLiteProvider, fontsLoaded, shouldRenderRouteSlot, startupFailure],
  );
  const resolvedContent = useMemo(
    () =>
      resolveAppRootLayoutContent({
        screen,
        startupFailure,
      }),
    [screen, startupFailure],
  );
  const rootContent = useMemo(
    () =>
      resolveAppRootLayoutRootContent({
        SQLiteProvider,
        databaseName,
        handleDatabaseInit,
        isBootstrapped,
        preProviderContent: resolvedContent.preProviderContent,
        providerContent: resolvedContent.providerContent,
        sqliteOptions,
      }),
    [
      SQLiteProvider,
      databaseName,
      handleDatabaseInit,
      isBootstrapped,
      resolvedContent.preProviderContent,
      resolvedContent.providerContent,
      sqliteOptions,
    ],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const contentWrapper = useCallback(
    (children: ReactNode) => renderKeyboardAvoidingWrapper(children),
    [],
  );

  // 7. Effects
  useEffect(() => {
    if (!fontsLoaded || SQLiteProvider || hasCompletedStartupRef.current) {
      return;
    }

    hasCompletedStartupRef.current = true;
    void SplashScreen.hideAsync();
  }, [SQLiteProvider, fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded || !startupFailure || hasCompletedStartupRef.current) {
      return;
    }

    hasCompletedStartupRef.current = true;
    void SplashScreen.hideAsync();
  }, [fontsLoaded, startupFailure]);

  useEffect(() => {
    if (
      !fontsLoaded ||
      !bootState.initialized ||
      !bootState.target ||
      startupFailure ||
      hasCompletedStartupRef.current
    ) {
      return;
    }

    hasCompletedStartupRef.current = true;
    router.replace(bootState.target);
    void SplashScreen.hideAsync();
  }, [bootState.initialized, bootState.target, fontsLoaded, router, startupFailure]);

  return {
    SQLiteProvider,
    bootState,
    contentWrapper,
    databaseName,
    fontsLoaded,
    handleDatabaseInit,
    isBootstrapped,
    preProviderContent: resolvedContent.preProviderContent,
    providerContent: resolvedContent.providerContent,
    rootContent,
    screen,
    shouldRenderRouteSlot,
    sqliteOptions,
    startupFailure,
  };
}
