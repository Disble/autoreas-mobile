import type { BootState } from '../../db-bootstrap.types';
import type { SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, ReactElement, ReactNode } from 'react';

/** Defines the app root layout props value shape. */
export type AppRootLayoutProps = Record<never, never>;

/** Defines the data contract for app root layout view model. */
export interface AppRootLayoutViewModel {
  readonly SQLiteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly bootState: BootState;
  readonly contentWrapper: (children: ReactNode) => ReactElement;
  readonly databaseName: string;
  readonly fontsLoaded: boolean;
  readonly handleDatabaseInit: SQLiteProviderProps['onInit'];
  readonly isBootstrapped: boolean;
  readonly sqliteOptions: {
    readonly enableChangeListener: boolean;
  };
}
