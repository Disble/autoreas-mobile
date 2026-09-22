import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  STARTUP_FONT_LOAD_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_DEADLINE_MS,
} from '../../startup.constants';
import { useStartup } from '../../use-startup';
import {
  createFontStartupFailure,
  createProviderReadinessStartupFailure,
  renderKeyboardAvoidingWrapper,
  navigateAndReleaseStartupSplash,
  releaseStartupBoundarySplashScreen,
  resolveStartupBoundaryContent,
  resolveStartupBoundaryRootContent,
  resolveStartupBoundaryScreen,
  resolveStartupFailureState,
} from './startup-boundary.helpers';
import { useStartupFailureLogs } from './use-startup-failure-logs';
import { useStartupSlowNotice } from './use-startup-slow-notice';
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
  const [hasFontLoadDeadlineElapsed, setHasFontLoadDeadlineElapsed] = useState(false);
  const [hasProviderReadinessDeadlineElapsed, setHasProviderReadinessDeadlineElapsed] =
    useState(false);

  // 3. Context/3rd Party Hooks
  const router = useRouter();
  const [fontsLoaded, fontLoadError] = useFonts({
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
  const shouldRenderRouteSlot = isReady && !startupState.failure;
  const fontStartupFailure = createFontStartupFailure({
    fontLoadError,
    hasFontLoadDeadlineElapsed,
  });
  const providerReadinessStartupFailure = createProviderReadinessStartupFailure({
    hasProviderReadinessDeadlineElapsed,
  });
  const { existingStartupFailure, isBootstrapped, startupFailure } = resolveStartupFailureState({
    fontStartupFailure,
    isReady,
    providerReadinessStartupFailure,
    startupStateFailure: startupState.failure,
  });
  const hasExceededSoftDeadline = useStartupSlowNotice({
    existingStartupFailure,
    fontsLoaded,
    hasSQLiteProvider: Boolean(SQLiteProvider),
    isReady,
  });
  useStartupFailureLogs({ failures: [fontStartupFailure, providerReadinessStartupFailure] });
  const screen = resolveStartupBoundaryScreen({
    fontsLoaded,
    hasSQLiteProvider: Boolean(SQLiteProvider),
    shouldRenderRouteSlot,
    startupFailure,
  });
  const resolvedContent = resolveStartupBoundaryContent({
    screen,
    startupFailure,
  });
  const rootContent = resolveStartupBoundaryRootContent({
    SQLiteProvider,
    databaseName,
    handleDatabaseInit,
    hasExceededSoftDeadline,
    isBootstrapped,
    preProviderContent: resolvedContent.preProviderContent,
    providerContent: resolvedContent.providerContent,
    sqliteOptions,
  });

  // 6. Callbacks (useCallback calling pure helpers)
  const contentWrapper = renderKeyboardAvoidingWrapper;

  // 7. Effects
  useEffect(() => {
    if (fontsLoaded || fontLoadError) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHasFontLoadDeadlineElapsed(true);
    }, STARTUP_FONT_LOAD_DEADLINE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fontLoadError, fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded || !SQLiteProvider || isReady || existingStartupFailure) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHasProviderReadinessDeadlineElapsed(true);
    }, STARTUP_PROVIDER_READINESS_DEADLINE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [SQLiteProvider, existingStartupFailure, fontsLoaded, isReady]);

  useEffect(() => {
    if (!fontsLoaded || SQLiteProvider || hasCompletedStartupRef.current) {
      return;
    }

    hasCompletedStartupRef.current = true;
    releaseStartupBoundarySplashScreen();
  }, [SQLiteProvider, fontsLoaded]);

  useEffect(() => {
    if (!startupFailure || hasCompletedStartupRef.current) {
      return;
    }

    hasCompletedStartupRef.current = true;
    releaseStartupBoundarySplashScreen();
  }, [startupFailure]);

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
    navigateAndReleaseStartupSplash(router, startupState.target);
  }, [fontsLoaded, isReady, router, startupFailure, startupState.target]);

  return {
    SQLiteProvider,
    contentWrapper,
    databaseName,
    fontsLoaded,
    handleDatabaseInit,
    hasExceededSoftDeadline,
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
