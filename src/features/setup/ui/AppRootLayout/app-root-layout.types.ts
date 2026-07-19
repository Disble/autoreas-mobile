import type { BootState, BootstrapFailure } from '../../db-bootstrap.types';
import type { SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, ReactElement, ReactNode } from 'react';

/** Defines the app root layout props value shape. */
export type AppRootLayoutProps = Record<never, never>;

/** Defines the render-only app root layout view props. */
export interface AppRootLayoutViewProps {
  readonly rootContent: ReactElement;
}

/** Defines the app root layout render screen values. */
export type AppRootLayoutScreen =
  | 'empty'
  | 'loading'
  | 'route-slot'
  | 'sqlite-unavailable'
  | 'startup-failure';

/** Defines the input required to resolve the app root layout screen. */
export interface ResolveAppRootLayoutScreenParams {
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly shouldRenderRouteSlot: boolean;
  readonly startupFailure: BootstrapFailure | null;
}

/** Defines the input required to resolve the app root layout rendered content. */
export interface ResolveAppRootLayoutContentParams {
  readonly screen: AppRootLayoutScreen;
  readonly startupFailure: BootstrapFailure | null;
}

/** Defines the resolved app root layout rendered content. */
export interface ResolvedAppRootLayoutContent {
  readonly preProviderContent: ReactElement | null;
  readonly providerContent: ReactElement | null;
}

/** Defines the input required to resolve the full app root layout tree. */
export interface ResolveAppRootLayoutRootContentParams {
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
export interface AppRootLayoutViewModel {
  readonly SQLiteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly bootState: BootState;
  readonly contentWrapper: (children: ReactNode) => ReactElement;
  readonly databaseName: string;
  readonly fontsLoaded: boolean;
  readonly handleDatabaseInit: SQLiteProviderProps['onInit'];
  readonly isBootstrapped: boolean;
  readonly preProviderContent: ReactElement | null;
  readonly providerContent: ReactElement | null;
  readonly rootContent: ReactElement;
  readonly screen: AppRootLayoutScreen;
  readonly shouldRenderRouteSlot: boolean;
  readonly sqliteOptions: {
    readonly enableChangeListener: boolean;
  };
  readonly startupFailure: BootstrapFailure | null;
}
