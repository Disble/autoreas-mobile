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
import { useStartup } from '../../use-startup';
import {
  renderKeyboardAvoidingWrapper,
  resolveStartupBoundaryContent,
  resolveStartupBoundaryRootContent,
  resolveStartupBoundaryScreen,
} from './startup-boundary.helpers';
import type {
  StartupBoundaryProps,
  StartupBoundaryViewModel,
} from './startup-boundary.types';

/** Coordinates app root layout state and actions. */
export function useStartupBoundary(
  _props: StartupBoundaryProps,
): StartupBoundaryViewModel {
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
  const { databaseName, handleDatabaseInit, isReady, sqliteOptions, sqliteProvider, startupState } =
    useStartup();

  // 5. Derived State (useMemo)
  const SQLiteProvider = sqliteProvider;
  const isBootstrapped = isReady;
  const shouldRenderRouteSlot = isReady && !startupState.failure;
  const startupFailure = startupState.failure;
  const screen = useMemo(
    () =>
      resolveStartupBoundaryScreen({
        fontsLoaded,
        hasSQLiteProvider: Boolean(SQLiteProvider),
        shouldRenderRouteSlot,
        startupFailure,
      }),
    [SQLiteProvider, fontsLoaded, shouldRenderRouteSlot, startupFailure],
  );
  const resolvedContent = useMemo(
    () =>
      resolveStartupBoundaryContent({
        screen,
        startupFailure,
      }),
    [screen, startupFailure],
  );
  const rootContent = useMemo(
    () =>
      resolveStartupBoundaryRootContent({
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
      !isReady ||
      !startupState.target ||
      startupFailure ||
      hasCompletedStartupRef.current
    ) {
      return;
    }

    hasCompletedStartupRef.current = true;
    router.replace(startupState.target);
    void SplashScreen.hideAsync();
  }, [fontsLoaded, isReady, router, startupFailure, startupState.target]);

  return {
    SQLiteProvider,
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
    startupState,
  };
}
