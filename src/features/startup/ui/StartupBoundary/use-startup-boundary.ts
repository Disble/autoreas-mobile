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
  STARTUP_FAILURE_RECOVERY_HINT,
  STARTUP_FONT_FAILURE_MESSAGE,
  STARTUP_FONT_LOAD_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_FAILURE_MESSAGE,
} from '../../startup.constants';
import { createStartupDiagnostic } from '../../startup.helpers';
import { useStartup } from '../../use-startup';
import {
  renderKeyboardAvoidingWrapper,
  navigateAndReleaseStartupSplash,
  releaseStartupBoundarySplashScreen,
  resolveStartupBoundaryContent,
  resolveStartupBoundaryRootContent,
  resolveStartupBoundaryScreen,
} from './startup-boundary.helpers';
import type {
  StartupBoundaryProps,
  StartupBoundaryViewModel,
} from './startup-boundary.types';
import type { StartupFailure } from '../../startup.types';

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
  const fontStartupFailure = (() => {
    if (!fontLoadError && !hasFontLoadDeadlineElapsed) {
      return null;
    }

    return {
      diagnostic: createStartupDiagnostic(
        'font_loading',
        fontLoadError ?? new Error('Font loading deadline exceeded'),
      ),
      diagnosticMessage: STARTUP_FONT_FAILURE_MESSAGE,
      recoveryHint: STARTUP_FAILURE_RECOVERY_HINT,
    };
  })();
  const existingStartupFailure = startupState.failure ?? fontStartupFailure;
  const providerReadinessStartupFailure: StartupFailure | null = (() => {
    if (!hasProviderReadinessDeadlineElapsed) {
      return null;
    }

    return {
      diagnostic: createStartupDiagnostic(
        'provider_readiness',
        new Error('SQLiteProvider readiness deadline exceeded'),
      ),
      diagnosticMessage: STARTUP_PROVIDER_READINESS_FAILURE_MESSAGE,
      recoveryHint: STARTUP_FAILURE_RECOVERY_HINT,
    };
  })();
  const startupFailure = existingStartupFailure ?? providerReadinessStartupFailure;
  const isBootstrapped = isReady && !startupFailure;
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
