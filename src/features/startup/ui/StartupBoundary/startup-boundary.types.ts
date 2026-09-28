import type { StartupFailure, StartupState } from '../../startup.types';
import type { StartupRecoveryState, StartupResetConfirmation, UseStartupRecoveryResult } from '../../recovery';
import type { Href } from 'expo-router';
import type { SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, MutableRefObject, ReactElement, ReactNode } from 'react';

/** Defines the app root layout props value shape. */
export type StartupBoundaryProps = Record<never, never>;

/** Defines the render-only app root layout view props. */
export interface StartupBoundaryViewProps {
  readonly rootContent: ReactElement;
}

/** Defines the render-only props of the startup loading placeholder. */
export interface StartupBoundaryLoadingProps {
  readonly isTakingLongerThanExpected: boolean;
}

/** Defines the inputs required to derive the font-loading startup failure. */
export interface CreateFontStartupFailureParams {
  readonly fontLoadError: Error | null;
  readonly hasFontLoadDeadlineElapsed: boolean;
}

/** Defines the inputs required to derive the provider-readiness startup failure. */
export interface CreateProviderReadinessStartupFailureParams {
  readonly hasProviderReadinessDeadlineElapsed: boolean;
}

/** Defines the raw inputs required to resolve the effective startup failure state. */
export interface ResolveStartupFailureStateParams {
  readonly fontStartupFailure: StartupFailure | null;
  readonly isReady: boolean;
  readonly providerReadinessStartupFailure: StartupFailure | null;
  readonly startupStateFailure: StartupFailure | null;
}

/** Defines the resolved startup failure chain and bootstrap readiness. */
export interface ResolvedStartupFailureState {
  readonly existingStartupFailure: StartupFailure | null;
  readonly isBootstrapped: boolean;
  readonly startupFailure: StartupFailure | null;
}

/** Defines the app root layout render screen values. */
export type StartupBoundaryScreen =
  | 'empty'
  | 'loading'
  | 'route-slot'
  | 'sqlite-unavailable'
  | 'startup-failure'
  | 'startup-recovery';

/**
 * Names the recovery presentations this boundary renders after a startup failure.
 *
 * `none` and `setup` are excluded because neither is a terminal card: `none` is the absence of a
 * failure and `setup` describes the ordinary first-run path that keeps routing. Every remaining
 * member carries a title, a description and, when the logic authorized one, its own action.
 */
export type StartupBoundaryRecoveryState = Exclude<
  StartupRecoveryState,
  { readonly kind: 'none' } | { readonly kind: 'setup' }
>;

/** Defines the terminal recovery presentation together with the actions it authorized. */
export interface StartupBoundaryRecovery {
  /** Carries the recovery result: its callbacks and its reset-confirmation visibility. */
  readonly actions: UseStartupRecoveryResult;
  /** Carries the presentation to render, which is never `none` and never `setup`. */
  readonly state: StartupBoundaryRecoveryState;
}

/** Defines the render-only props of the single destructive reset confirmation. */
export interface StartupDatabaseResetDialogProps {
  /** Carries the confirmation copy the recovery logic authorized, wording included. */
  readonly confirmation: StartupResetConfirmation;
  /** Reports whether the destructive confirmation is currently open. */
  readonly isVisible: boolean;
  /** Runs when the user dismisses the confirmation without confirming it. */
  readonly onCancel: () => void;
  /** Runs when the user confirms that the local database may be destroyed. */
  readonly onConfirm: () => void;
}

/** Defines the navigation contract needed to complete startup routing. */
export interface StartupRouteRouter {
  readonly replace: (target: Href) => void;
}

/** Defines the input required to resolve the app root layout screen. */
export interface ResolveStartupBoundaryScreenParams {
  readonly fontsLoaded: boolean;
  /**
   * Reports whether the recovery layer has a terminal presentation for the current failure.
   *
   * Only a real startup-state failure can produce one: the font-loading and provider-readiness
   * failures the boundary invents are not database situations, so they keep the generic card.
   * Optional so a caller that predates the recovery surface keeps its previous screen.
   */
  readonly hasRenderableRecovery?: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly shouldRenderRouteSlot: boolean;
  readonly startupFailure: StartupFailure | null;
}

/** Defines the input required to resolve the app root layout rendered content. */
export interface ResolveStartupBoundaryContentParams {
  /** Carries the renderable recovery presentation, or `null` when this failure has none. */
  readonly recovery?: StartupBoundaryRecovery | null;
  readonly screen: StartupBoundaryScreen;
  readonly startupFailure: StartupFailure | null;
}

/** Defines the inputs required to decide whether the provider-readiness deadline should arm. */
export interface ShouldArmProviderReadinessDeadlineParams {
  readonly existingStartupFailure: StartupFailure | null;
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly isReady: boolean;
}

/** Defines the inputs required to decide whether startup may navigate to its route target. */
export interface ShouldNavigateAfterStartupParams {
  readonly fontsLoaded: boolean;
  readonly isReady: boolean;
  readonly startupFailure: StartupFailure | null;
  readonly target: Href | null;
}

/** Defines the resolved app root layout rendered content. */
export interface ResolvedStartupBoundaryContent {
  readonly preProviderContent: ReactElement | null;
  readonly providerContent: ReactElement | null;
}

/** Defines the input required to resolve the full app root layout tree. */
export interface ResolveStartupBoundaryRootContentParams {
  readonly SQLiteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly databaseName: string;
  readonly handleDatabaseInit: SQLiteProviderProps['onInit'];
  readonly hasExceededSoftDeadline: boolean;
  readonly isBootstrapped: boolean;
  readonly preProviderContent: ReactElement | null;
  readonly providerContent: ReactElement | null;
  readonly sqliteOptions: {
    readonly enableChangeListener: boolean;
  };
}

/** Defines the data contract for app root layout view model. */
export interface StartupBoundaryViewModel {
  readonly SQLiteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly contentWrapper: (children: ReactNode) => ReactElement;
  readonly databaseName: string;
  readonly fontsLoaded: boolean;
  readonly handleDatabaseInit: SQLiteProviderProps['onInit'];
  readonly hasExceededSoftDeadline: boolean;
  readonly isBootstrapped: boolean;
  readonly preProviderContent: ReactElement | null;
  readonly providerContent: ReactElement | null;
  readonly rootContent: ReactElement;
  readonly screen: StartupBoundaryScreen;
  readonly shouldRenderRouteSlot: boolean;
  readonly sqliteOptions: {
    readonly enableChangeListener: boolean;
  };
  readonly startupFailure: StartupFailure | null;
  readonly startupState: StartupState;
}

/** Defines the inputs of the font-load deadline effect. */
export interface StartupBoundaryFontLoadDeadlineParams {
  readonly fontLoadError: Error | null;
  readonly fontsLoaded: boolean;
  readonly onDeadlineElapsed: () => void;
}

/** Defines the inputs of the provider-readiness deadline effect. */
export interface StartupBoundaryProviderReadinessDeadlineParams {
  readonly existingStartupFailure: StartupFailure | null;
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly isReady: boolean;
  readonly onDeadlineElapsed: () => void;
}

/** Defines the inputs of the splash release that runs when no provider ever mounts. */
export interface StartupBoundarySplashReleaseParams {
  readonly fontsLoaded: boolean;
  readonly hasCompletedStartupRef: MutableRefObject<boolean>;
  readonly hasSQLiteProvider: boolean;
}

/** Defines the inputs of the splash release that runs on a terminal startup failure. */
export interface StartupBoundaryTerminalFailureSplashParams {
  readonly hasCompletedStartupRef: MutableRefObject<boolean>;
  readonly startupFailure: StartupFailure | null;
}

/** Defines the inputs of the navigation effect that completes startup routing. */
export interface StartupBoundaryNavigationParams {
  readonly fontsLoaded: boolean;
  readonly hasCompletedStartupRef: MutableRefObject<boolean>;
  readonly isReady: boolean;
  readonly router: StartupRouteRouter;
  readonly startupFailure: StartupFailure | null;
  readonly target: Href | null;
}

/** Defines the inputs of the startup completion lifecycle hook. */
export interface StartupBoundaryLifecycleParams {
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly isReady: boolean;
  readonly router: StartupRouteRouter;
  readonly startupFailure: StartupFailure | null;
  readonly target: Href | null;
}

/** Defines the startup completion lifecycle handle. */
export interface StartupBoundaryLifecycleResult {
  readonly resetCompletion: () => void;
}

/** Defines the inputs that decide whether the route slot may render. */
export interface ShouldRenderStartupRouteSlotParams {
  readonly isReady: boolean;
  readonly startupFailure: StartupFailure | null;
}
