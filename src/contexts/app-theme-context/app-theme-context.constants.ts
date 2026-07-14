import { createContext } from 'react';
import type { AppThemeContextValue, ThemeName } from './app-theme-context.types';

/** Provides the application theme context shared by consumers. */
export const AppThemeContext = createContext<AppThemeContextValue | undefined>(undefined);

/** Maps every theme to its light or dark counterpart. */
export const THEME_TOGGLE_MAP: Readonly<Record<ThemeName, ThemeName>> = {
  light: 'dark',
  dark: 'light',
  'lavender-light': 'lavender-dark',
  'lavender-dark': 'lavender-light',
  'mint-light': 'mint-dark',
  'mint-dark': 'mint-light',
  'sky-light': 'sky-dark',
  'sky-dark': 'sky-light',
};
