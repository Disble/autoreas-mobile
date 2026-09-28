import { useCallback, useEffect, useRef } from 'react';
import {
  STARTUP_FONT_LOAD_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_DEADLINE_MS,
} from '../../startup.constants';
import {
  hasTerminalStartupFailure,
  navigateAndReleaseStartupSplash,
  releaseStartupBoundarySplashScreen,
  shouldArmFontLoadDeadline,
  shouldArmProviderReadinessDeadline,
  shouldNavigateAfterStartup,
  shouldReleaseSplashScreenWithoutProvider,
} from './startup-boundary.helpers';
import type {
  StartupBoundaryFontLoadDeadlineParams,
  StartupBoundaryLifecycleParams,
  StartupBoundaryLifecycleResult,
  StartupBoundaryNavigationParams,
  StartupBoundaryProviderReadinessDeadlineParams,
  StartupBoundarySplashReleaseParams,
  StartupBoundaryTerminalFailureSplashParams,
} from './startup-boundary.types';

/**
 * Arms the font-load deadline, which is the boundary's proof that fonts neither loaded nor failed
 * inside their allowance. The decision itself lives in [shouldArmFontLoadDeadline] so this effect
 * only wires a timer to it.
 */
export function useStartupBoundaryFontLoadDeadline(
  params: Readonly<StartupBoundaryFontLoadDeadlineParams>,
): void {
  const { fontLoadError, fontsLoaded, onDeadlineElapsed } = params;

  useEffect(() => {
    if (!shouldArmFontLoadDeadline(fontsLoaded, fontLoadError)) {
      return;
    }

    const timeoutId = setTimeout(onDeadlineElapsed, STARTUP_FONT_LOAD_DEADLINE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fontLoadError, fontsLoaded, onDeadlineElapsed]);
}

/**
 * Arms the provider-readiness deadline, the boundary's proof that the SQLite provider did not
 * become ready inside its allowance. The decision itself lives in
 * [shouldArmProviderReadinessDeadline], including the rule that an already-resolved failure
 * disarms the timer.
 */
export function useStartupBoundaryProviderReadinessDeadline(
  params: Readonly<StartupBoundaryProviderReadinessDeadlineParams>,
): void {
  const { existingStartupFailure, fontsLoaded, hasSQLiteProvider, isReady, onDeadlineElapsed } =
    params;

  useEffect(() => {
    if (
      !shouldArmProviderReadinessDeadline({
        existingStartupFailure,
        fontsLoaded,
        hasSQLiteProvider,
        isReady,
      })
    ) {
      return;
    }

    const timeoutId = setTimeout(onDeadlineElapsed, STARTUP_PROVIDER_READINESS_DEADLINE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [existingStartupFailure, fontsLoaded, hasSQLiteProvider, isReady, onDeadlineElapsed]);
}

/**
 * Releases the splash screen as soon as fonts settled without a provider ever mounting, so a device
 * that cannot even build the provider is not left behind the splash. The one-shot ref keeps the
 * release from running twice.
 */
function useStartupBoundarySplashRelease(params: Readonly<StartupBoundarySplashReleaseParams>): void {
  const { fontsLoaded, hasCompletedStartupRef, hasSQLiteProvider } = params;

  useEffect(() => {
    if (hasCompletedStartupRef.current) {
      return;
    }

    if (!shouldReleaseSplashScreenWithoutProvider(fontsLoaded, hasSQLiteProvider)) {
      return;
    }

    hasCompletedStartupRef.current = true;
    releaseStartupBoundarySplashScreen();
  }, [fontsLoaded, hasCompletedStartupRef, hasSQLiteProvider]);
}

/**
 * Releases the splash screen on a terminal startup failure so the controlled failure UI can render
 * instead of an endless splash. Shares the one-shot ref with every other release path, so exactly
 * one of them ever releases.
 */
function useStartupBoundaryTerminalFailureSplash(
  params: Readonly<StartupBoundaryTerminalFailureSplashParams>,
): void {
  const { hasCompletedStartupRef, startupFailure } = params;

  useEffect(() => {
    if (hasCompletedStartupRef.current) {
      return;
    }

    if (!hasTerminalStartupFailure(startupFailure)) {
      return;
    }

    hasCompletedStartupRef.current = true;
    releaseStartupBoundarySplashScreen();
  }, [hasCompletedStartupRef, startupFailure]);
}

/**
 * Navigates to the resolved startup target and releases the splash, or does nothing while the
 * target is still undecided. [shouldNavigateAfterStartup] owns the agreement rule (fonts settled,
 * runtime ready, target resolved, no terminal failure), so this effect never duplicates it.
 */
function useStartupBoundaryNavigation(params: Readonly<StartupBoundaryNavigationParams>): void {
  const { fontsLoaded, hasCompletedStartupRef, isReady, router, startupFailure, target } = params;

  useEffect(() => {
    if (hasCompletedStartupRef.current) {
      return;
    }

    if (!shouldNavigateAfterStartup({ fontsLoaded, isReady, startupFailure, target })) {
      return;
    }

    hasCompletedStartupRef.current = true;
    navigateAndReleaseStartupSplash(router, target as NonNullable<typeof target>);
  }, [fontsLoaded, hasCompletedStartupRef, isReady, router, startupFailure, target]);
}

/**
 * Owns the startup completion lifecycle: the single one-shot ref that every release and navigation
 * path shares, the three effects built on it, and the handle that re-arms them.
 *
 * The ref is the reason this is one hook rather than three: a successful database reset has to make
 * the splash and navigation effects runnable again, and clearing one shared flag is what expresses
 * "a genuinely new startup attempt started" without duplicating any decision here. Every decision
 * stays in the pure helpers this file calls, so the hook adds no branching of its own beyond the
 * wiring each effect needs.
 */
export function useStartupBoundaryLifecycle(
  params: Readonly<StartupBoundaryLifecycleParams>,
): StartupBoundaryLifecycleResult {
  const { fontsLoaded, hasSQLiteProvider, isReady, router, startupFailure, target } = params;
  const hasCompletedStartupRef = useRef(false);
  const resetCompletion = useCallback((): void => {
    hasCompletedStartupRef.current = false;
  }, []);

  useStartupBoundarySplashRelease({ fontsLoaded, hasCompletedStartupRef, hasSQLiteProvider });
  useStartupBoundaryTerminalFailureSplash({ hasCompletedStartupRef, startupFailure });
  useStartupBoundaryNavigation({
    fontsLoaded,
    hasCompletedStartupRef,
    isReady,
    router,
    startupFailure,
    target,
  });

  return { resetCompletion };
}
