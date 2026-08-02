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
import type {
  StartupBoundaryScreen,
  ResolveStartupBoundaryContentParams,
  ResolveStartupBoundaryRootContentParams,
  ResolveStartupBoundaryScreenParams,
  ResolvedStartupBoundaryContent,
  StartupRouteRouter,
} from './startup-boundary.types';
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
 * Resolves which root-layout screen should render from the current startup state.
 * Centralizing this decision keeps the `.tsx` file focused on view rendering while the hook owns startup state selection.
 */
export function resolveStartupBoundaryScreen(
  params: Readonly<ResolveStartupBoundaryScreenParams>,
): StartupBoundaryScreen {
  if (params.startupFailure) {
    return 'startup-failure';
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

  if (params.screen === 'startup-failure' && params.startupFailure) {
    return {
      preProviderContent: createElement(StartupBoundaryFallback, {
        failure: params.startupFailure,
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
        { fallback: createElement(StartupBoundaryLoading) },
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
