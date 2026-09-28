import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useStartupRecovery } from '../../recovery/use-startup-recovery';
import type { StartupRecoveryCause } from '../../recovery/recovery.types';
import { useStartup } from '../../use-startup';
import {
  createFontStartupFailure,
  createProviderReadinessStartupFailure,
  createStartupRecoveryCause,
  renderKeyboardAvoidingWrapper,
  resolveStartupBoundaryContent,
  resolveStartupBoundaryRecovery,
  resolveStartupBoundaryRootContent,
  resolveStartupBoundaryScreen,
  resolveStartupFailureClassification,
  resolveStartupFailureState,
  shouldRenderStartupRouteSlot,
} from './startup-boundary.helpers';
import {
  useStartupBoundaryFontLoadDeadline,
  useStartupBoundaryLifecycle,
  useStartupBoundaryProviderReadinessDeadline,
} from './use-startup-boundary-lifecycle';
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
  // 1. Refs. There is deliberately no completion ref here: the one-shot startup completion flag is
  // owned by `useStartupBoundaryLifecycle`, together with every effect that reads it.

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
  const {
    databaseName,
    getActiveDatabase,
    handleDatabaseInit,
    isReady,
    remountDatabaseProvider,
    sqliteOptions,
    sqliteProvider,
    startupState,
  } = useStartup();

  // 5. Derived State (useMemo)
  const SQLiteProvider = sqliteProvider;
  const shouldRenderRouteSlot = shouldRenderStartupRouteSlot({
    isReady,
    startupFailure: startupState.failure,
  });
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
  const recoveryCause = useMemo<StartupRecoveryCause | null>(
    () => createStartupRecoveryCause(resolveStartupFailureClassification(startupState.failure)),
    [startupState.failure],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const contentWrapper = renderKeyboardAvoidingWrapper;
  const { resetCompletion } = useStartupBoundaryLifecycle({
    fontsLoaded,
    hasSQLiteProvider: Boolean(SQLiteProvider),
    isReady,
    router,
    startupFailure,
    target: startupState.target,
  });
  /** Settles the font-load deadline exactly once so its effect stops rescheduling. */
  const handleFontLoadDeadlineElapsed = useCallback((): void => {
    setHasFontLoadDeadlineElapsed(true);
  }, []);
  /** Settles the provider-readiness deadline exactly once so its effect stops rescheduling. */
  const handleProviderReadinessDeadlineElapsed = useCallback((): void => {
    setHasProviderReadinessDeadlineElapsed(true);
  }, []);
  /**
   * Makes the recovery retry and the post-reset remount start a genuinely new startup attempt.
   *
   * Clearing the completion ref is what lets the splash and navigation effects run again: without
   * it they would early-return for the rest of the session, the fresh provider's ready state would
   * never navigate, and a successful reset would leave the user in front of a terminal card.
   */
  const handleRemountDatabaseProvider = useCallback((): void => {
    resetCompletion();
    remountDatabaseProvider();
  }, [remountDatabaseProvider, resetCompletion]);

  // 7. Recovery and the content it resolves. The recovery hook consumes the remount callback
  // above, so it runs after the callbacks section; the screen is resolved here because the
  // recovery screen exists only when the recovery layer has a terminal presentation to show, and
  // that presentation has to reach the fallback element together with the failure it explains.
  const recovery = useStartupRecovery({
    cause: recoveryCause,
    // The provider's live connection, captured by the initializer: the recovery card renders
    // outside `SQLiteProvider`, so the SQLite context is null here and the reset would otherwise
    // delete the database while that connection is still open.
    getActiveDatabase,
    remountProvider: handleRemountDatabaseProvider,
  });
  const recoveryPresentation = resolveStartupBoundaryRecovery(recovery);
  const screen = resolveStartupBoundaryScreen({
    fontsLoaded,
    hasRenderableRecovery: recoveryPresentation !== null,
    hasSQLiteProvider: Boolean(SQLiteProvider),
    shouldRenderRouteSlot,
    startupFailure,
  });
  const resolvedContent = resolveStartupBoundaryContent({
    recovery: recoveryPresentation,
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

  // 8. Effects. Every effect owns only wiring: the decision inside its guard lives in a pure
  // helper, and the shared one-shot completion ref lives in [useStartupBoundaryLifecycle] so the
  // splash and navigation paths cannot disagree about whether startup already completed.
  useStartupBoundaryFontLoadDeadline({
    fontLoadError,
    fontsLoaded,
    onDeadlineElapsed: handleFontLoadDeadlineElapsed,
  });
  useStartupBoundaryProviderReadinessDeadline({
    existingStartupFailure,
    fontsLoaded,
    hasSQLiteProvider: Boolean(SQLiteProvider),
    isReady,
    onDeadlineElapsed: handleProviderReadinessDeadlineElapsed,
  });

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
