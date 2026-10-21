import type { ReactNode } from 'react';

/** Defines every theme supported by the application. */
export type ThemeName = 'light' | 'dark';

/** Defines the application theme context contract. */
export interface AppThemeContextValue {
  readonly currentTheme: string;
  readonly isLight: boolean;
  readonly isDark: boolean;
  readonly setTheme: (theme: ThemeName) => void;
  readonly toggleTheme: () => void;
}

/** Defines the application theme provider props. */
export interface AppThemeProviderProps {
  readonly children: ReactNode;
}
