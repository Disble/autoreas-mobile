import * as SplashScreen from 'expo-splash-screen';
import { HeroUINativeProvider } from 'heroui-native';
import { Slot } from 'expo-router';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createElement, Fragment, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteUnavailableScreen } from '../../../../components/sqlite-unavailable-screen';
import { AppThemeProvider } from '../../../../contexts/app-theme-context/app-theme-context';
import { SyncRuntimeGate } from '../../../sync/ui/SyncRuntimeGate/SyncRuntimeGate';
import { StartupBoundaryLoading } from './StartupBoundaryLoading';
import { StartupBoundaryFallback } from './StartupBoundaryFallback';
import {
  STARTUP_FAILURE_RECOVERY_HINT,
  STARTUP_FONT_FAILURE_MESSAGE,
  STARTUP_PROVIDER_READINESS_FAILURE_MESSAGE,
} from '../../startup.constants';
import { createStartupDiagnostic } from '../../startup.helpers';
import type { StartupFailure, StartupFailureClassification } from '../../startup.types';
import type {
  StartupBoundaryRecovery,
  StartupBoundaryScreen,
  CreateFontStartupFailureParams,
  CreateProviderReadinessStartupFailureParams,
  ResolveStartupBoundaryContentParams,
  ResolveStartupBoundaryRootContentParams,
  ResolveStartupBoundaryScreenParams,
  ResolveStartupFailureStateParams,
  ResolvedStartupBoundaryContent,
  ResolvedStartupFailureState,
  ShouldArmProviderReadinessDeadlineParams,
  ShouldNavigateAfterStartupParams,
  ShouldRenderStartupRouteSlotParams,
  StartupRouteRouter,
} from './startup-boundary.types';
import type { StartupRecoveryCause, UseStartupRecoveryResult } from '../../recovery';
import type { Href } from 'expo-router';

/**
 * Prepares the native splash screen before the app root layout renders any React-controlled UI.
 */
export function prepareStartupBoundarySplashScreen() {
  SplashScreen.setOptions({
    duration: 300,
    fade: true,
  });

  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

/**
 * Starts one native splash release attempt after startup reaches a terminal state.
 * Keeping this call centralized lets every terminal path preserve the same one-time ref policy in the hook.
 */
export function releaseStartupBoundarySplashScreen() {
  void SplashScreen.hideAsync().catch(() => {
    try {
      SplashScreen.hide();
    } catch {
      // The final native release attempt has no further recovery path.
    }
  });
}

/**
 * Replaces the startup route and releases the native splash exactly once, including synchronous navigation failures.
 * Navigation exceptions are rethrown unchanged so React's existing error handling retains the original failure.
 */
export function navigateAndReleaseStartupSplash(router: StartupRouteRouter, target: Href) {
  try {
    router.replace(target);
  } catch (error) {
    releaseStartupBoundarySplashScreen();
    throw error;
  }

  releaseStartupBoundarySplashScreen();
}

/**
 * Wraps toast content in the keyboard-avoiding container required by the root provider.
 * This keeps the render-only provider callback out of the hook body while preserving layout behavior.
 */
export function renderKeyboardAvoidingWrapper(children: ReactNode) {
  return createElement(
    KeyboardAvoidingView,
    {
      behavior: 'padding',
      className: 'flex-1',
      keyboardVerticalOffset: 12,
      pointerEvents: 'box-none',
    },
    children,
  );
}

/**
 * Derives the terminal failure presented when font loading fails or misses its deadline.
 * Returns null while fonts may still arrive so the boundary keeps waiting instead of failing early.
 */
export function createFontStartupFailure(
  params: Readonly<CreateFontStartupFailureParams>,
): StartupFailure | null {
  if (!params.fontLoadError && !params.hasFontLoadDeadlineElapsed) {
    return null;
  }

  return {
    diagnostic: createStartupDiagnostic(
      'font_loading',
      params.fontLoadError ?? new Error('Font loading deadline exceeded'),
    ),
    diagnosticMessage: STARTUP_FONT_FAILURE_MESSAGE,
    recoveryHint: STARTUP_FAILURE_RECOVERY_HINT,
  };
}

/**
 * Derives the terminal failure presented when SQLiteProvider readiness misses its deadline.
 * Returns null until the readiness deadline elapses so normal startup stays uninterrupted.
 */
export function createProviderReadinessStartupFailure(
  params: Readonly<CreateProviderReadinessStartupFailureParams>,
): StartupFailure | null {
  if (!params.hasProviderReadinessDeadlineElapsed) {
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
}

/**
 * Resolves the effective startup failure chain and bootstrap readiness from the raw failure inputs.
 * The startup state failure wins over the font failure, provider readiness is the last resort, and
 * bootstrap readiness requires the runtime to be ready with no terminal failure at all.
 */
export function resolveStartupFailureState(
  params: Readonly<ResolveStartupFailureStateParams>,
): ResolvedStartupFailureState {
  const existingStartupFailure = params.startupStateFailure ?? params.fontStartupFailure;
  const startupFailure = existingStartupFailure ?? params.providerReadinessStartupFailure;

  return {
    existingStartupFailure,
    isBootstrapped: params.isReady && !startupFailure,
    startupFailure,
  };
}

/**
 * Decides whether the font-load deadline effect should arm its timeout.
 * The deadline only matters while fonts may still arrive: once loading settles, either with the
 * family set or with an error, the outcome is already terminal and a timer would be pure waste.
 */
export function shouldArmFontLoadDeadline(
  fontsLoaded: boolean,
  fontLoadError: Error | null,
): boolean {
  // Falsy, NOT `=== null`: the original effect guard was `if (fontsLoaded || fontLoadError)`, and
  // `useFonts` reports "no error yet" as `undefined`. Requiring `null` exactly would refuse to arm
  // the deadline on that value and leave a never-settling font load stuck on the splash forever.
  return !fontsLoaded && !fontLoadError;
}

/**
 * Decides whether the provider-readiness deadline effect should arm its timeout.
 * Normal startup stays uninterrupted: the deadline only arms while fonts are settled, the provider
 * is mounted, readiness has not arrived yet, and no terminal failure already explains the wait.
 */
export function shouldArmProviderReadinessDeadline(
  params: Readonly<ShouldArmProviderReadinessDeadlineParams>,
): boolean {
  return (
    params.fontsLoaded &&
    params.hasSQLiteProvider &&
    !params.isReady &&
    params.existingStartupFailure === null
  );
}

/**
 * Decides whether the font-driven splash release should run on a boundary without a provider.
 * A mounted provider releases the splash through its own readiness and navigation effects; without
 * one, settled fonts are the last chance to release the splash before the failure card shows.
 */
export function shouldReleaseSplashScreenWithoutProvider(
  fontsLoaded: boolean,
  hasSQLiteProvider: boolean,
): boolean {
  return fontsLoaded && !hasSQLiteProvider;
}

/** Reports whether an effective startup failure reached its terminal presentation. */
export function hasTerminalStartupFailure(startupFailure: StartupFailure | null): boolean {
  return startupFailure !== null;
}

/**
 * Decides whether startup may navigate to its resolved route target and release the splash.
 * Every input must agree: fonts settled, runtime ready, a target resolved, and no terminal
 * failure overriding the route with a failure card.
 */
export function shouldNavigateAfterStartup(
  params: Readonly<ShouldNavigateAfterStartupParams>,
): boolean {
  return (
    params.fontsLoaded &&
    params.isReady &&
    params.target !== null &&
    params.startupFailure === null
  );
}

/**
 * Builds the recovery cause from the startup-state failure's own classification.
 * The recovery layer consumes only the classification of the startup state failure, never of the
 * effective failure: the boundary also invents font-loading and provider-readiness failures, and
 * those are not database situations, so they must never present database recovery copy.
 */
export function createStartupRecoveryCause(
  classification: StartupFailureClassification | null,
): StartupRecoveryCause | null {
  if (classification === null) {
    return null;
  }

  return { classification, kind: 'startup_failure' };
}

/**
 * Resolves which root-layout screen should render from the current startup state.
 * Centralizing this decision keeps the `.tsx` file focused on view rendering while the hook owns startup state selection.
 * The recovery screen only replaces the generic failure screen when the recovery layer has a
 * terminal presentation for the failure, so a font-loading or provider-readiness failure never
 * presents database recovery copy.
 */
export function resolveStartupBoundaryScreen(
  params: Readonly<ResolveStartupBoundaryScreenParams>,
): StartupBoundaryScreen {
  if (params.startupFailure) {
    return params.hasRenderableRecovery === true ? 'startup-recovery' : 'startup-failure';
  }

  if (!params.fontsLoaded) {
    return 'loading';
  }

  if (!params.hasSQLiteProvider) {
    return 'sqlite-unavailable';
  }

  if (params.shouldRenderRouteSlot) {
    return 'route-slot';
  }

  return 'empty';
}

/**
 * Groups a recovery result with the terminal presentation this boundary is able to render.
 *
 * `none` and `setup` are deliberately not terminal cards: `none` means no failure exists at all,
 * and `setup` describes the ordinary first-run path that keeps routing to the setup screen.
 * Rendering either as a failure card would describe a state the user is not in, so both fall back
 * to the generic explanation the boundary already owns for a failure it cannot explain further.
 */
export function resolveStartupBoundaryRecovery(
  recovery: UseStartupRecoveryResult,
): StartupBoundaryRecovery | null {
  const { recoveryState } = recovery;

  if (recoveryState.kind === 'none' || recoveryState.kind === 'setup') {
    return null;
  }

  return { actions: recovery, state: recoveryState };
}

/**
 * Resolves the concrete content that the root layout should present for the current startup state.
 * This keeps screen selection and fallback assembly out of the `.tsx` file so the view stays render-only.
 */
export function resolveStartupBoundaryContent(
  params: Readonly<ResolveStartupBoundaryContentParams>,
): ResolvedStartupBoundaryContent {
  if (params.screen === 'loading') {
    return {
      preProviderContent: createElement(Fragment),
      providerContent: null,
    };
  }

  if (params.screen === 'sqlite-unavailable') {
    return {
      preProviderContent: createElement(SQLiteUnavailableScreen),
      providerContent: null,
    };
  }

  if (params.startupFailure && (params.screen === 'startup-failure' || params.screen === 'startup-recovery')) {
    // Both screens present the same terminal card. The recovery presentation is attached when the
    // recovery layer has a renderable one, and its absence falls back to the generic explanation
    // instead of rendering nothing at all.
    return {
      preProviderContent: createElement(StartupBoundaryFallback, {
        failure: params.startupFailure,
        recovery: params.recovery ?? null,
      }),
      providerContent: null,
    };
  }

  if (params.screen === 'route-slot') {
    return {
      preProviderContent: null,
      providerContent: createElement(Slot),
    };
  }

  return {
    preProviderContent: null,
    providerContent: null,
  };
}

/**
 * Resolves the full root-layout tree from the prepared view-model values.
 * This keeps provider selection and pre-provider fallback branching out of the `.tsx` file.
 */
export function resolveStartupBoundaryRootContent(
  params: Readonly<ResolveStartupBoundaryRootContentParams>,
) {
  const HeroUINativeProviderComponent = HeroUINativeProvider as unknown as ComponentType<{
    readonly config: {
      readonly textProps: {
        readonly maxFontSizeMultiplier: number;
      };
      readonly toast: {
        readonly contentWrapper: typeof renderKeyboardAvoidingWrapper;
      };
    };
  }>;
  const SyncRuntimeGateComponent = SyncRuntimeGate as unknown as ComponentType<{
    readonly isBootstrapped: boolean;
  }>;

  const bootstrappedContent = params.isBootstrapped
    ? createElement(
        SyncRuntimeGateComponent,
        {
          isBootstrapped: true,
        },
        params.providerContent,
      )
    : params.providerContent;

  const SQLiteProviderComponent = params.SQLiteProvider as ComponentType<{
    readonly databaseName: string;
    readonly onInit: ResolveStartupBoundaryRootContentParams['handleDatabaseInit'];
    readonly options: ResolveStartupBoundaryRootContentParams['sqliteOptions'];
    readonly useSuspense: true;
  }>;

  const sqliteContent = params.SQLiteProvider
    ? createElement(
        SQLiteProviderComponent,
        {
          databaseName: params.databaseName,
          onInit: params.handleDatabaseInit,
          options: params.sqliteOptions,
          useSuspense: true,
        },
        bootstrappedContent,
      )
    : bootstrappedContent;

  // Terminal startup content must stay outside SQLiteProvider because the provider can retain Suspense indefinitely.
  const rootContent = params.preProviderContent ?? sqliteContent;

  const providerShell = createElement(
    AppThemeProvider,
    null,
    createElement(
      HeroUINativeProviderComponent,
      {
        config: {
          textProps: {
            maxFontSizeMultiplier: 2,
          },
          toast: {
            contentWrapper: renderKeyboardAvoidingWrapper,
          },
        },
      },
      createElement(
        Suspense,
        {
          fallback: createElement(StartupBoundaryLoading, {
            isTakingLongerThanExpected: params.hasExceededSoftDeadline,
          }),
        },
        rootContent,
      ),
    ),
  );

  return createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    createElement(
      SafeAreaView,
      {
        style: { flex: 1 },
        edges: ['top', 'bottom'],
      },
      createElement(
        KeyboardProvider,
        null,
        providerShell,
      ),
    ),
  );
}

/**
 * Reads the recovery classification from the startup state's OWN failure, never from the effective
 * failure: the boundary also invents font-loading and provider-readiness failures, and those are
 * not database situations, so they must never present database recovery copy.
 */
export function resolveStartupFailureClassification(
  startupFailure: StartupFailure | null,
): StartupFailureClassification | null {
  return startupFailure === null ? null : startupFailure.diagnostic.classification;
}

/** Decides whether the route slot may render: the runtime is ready and no terminal failure exists. */
export function shouldRenderStartupRouteSlot(
  params: Readonly<ShouldRenderStartupRouteSlotParams>,
): boolean {
  return params.isReady && params.startupFailure === null;
}
