import type { StartupFailure, StartupState } from '../../startup.types';
import type { Href } from 'expo-router';
import type { SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, ReactElement, ReactNode } from 'react';

/** Defines the app root layout props value shape. */
export type StartupBoundaryProps = Record<never, never>;

/** Defines the render-only app root layout view props. */
export interface StartupBoundaryViewProps {
  readonly rootContent: ReactElement;
}

/** Defines the app root layout render screen values. */
export type StartupBoundaryScreen =
  | 'empty'
  | 'loading'
  | 'route-slot'
  | 'sqlite-unavailable'
  | 'startup-failure';

/** Defines the navigation contract needed to complete startup routing. */
export interface StartupRouteRouter {
  readonly replace: (target: Href) => void;
}

/** Defines the input required to resolve the app root layout screen. */
export interface ResolveStartupBoundaryScreenParams {
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly shouldRenderRouteSlot: boolean;
  readonly startupFailure: StartupFailure | null;
}

/** Defines the input required to resolve the app root layout rendered content. */
export interface ResolveStartupBoundaryContentParams {
  readonly screen: StartupBoundaryScreen;
  readonly startupFailure: StartupFailure | null;
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
