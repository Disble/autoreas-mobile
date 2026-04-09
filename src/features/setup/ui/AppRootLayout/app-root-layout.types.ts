import type { BootState } from '../../db-bootstrap.types';
import type { SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, ReactElement, ReactNode } from 'react';

export type AppRootLayoutProps = Record<never, never>;

export interface AppRootLayoutViewModel {
  readonly SQLiteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly bootState: BootState;
  readonly contentWrapper: (children: ReactNode) => ReactElement;
  readonly databaseName: string;
  readonly fontsLoaded: boolean;
  readonly handleDatabaseInit: SQLiteProviderProps['onInit'];
  readonly sqliteOptions: {
    readonly enableChangeListener: boolean;
  };
}
