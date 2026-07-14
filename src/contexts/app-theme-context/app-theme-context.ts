import { createElement, useCallback, useContext, useMemo } from 'react';
import { Uniwind, useUniwind } from 'uniwind';
import { AppThemeContext, THEME_TOGGLE_MAP } from './app-theme-context.constants';
import type { AppThemeProviderProps, ThemeName } from './app-theme-context.types';

/** Provides theme state and actions to the application tree. */
export function AppThemeProvider({ children }: Readonly<AppThemeProviderProps>) {
  const { theme } = useUniwind();
  const isLight = useMemo(() => theme === 'light' || theme.endsWith('-light'), [theme]);
  const isDark = useMemo(() => theme === 'dark' || theme.endsWith('-dark'), [theme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    Uniwind.setTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = THEME_TOGGLE_MAP[theme];
    if (next) {
      Uniwind.setTheme(next);
    }
  }, [theme]);

  const value = useMemo(
    () => ({ currentTheme: theme, isLight, isDark, setTheme, toggleTheme }),
    [theme, isLight, isDark, setTheme, toggleTheme],
  );

  return createElement(AppThemeContext.Provider, { value }, children);
}

/** Returns the active theme context and rejects use outside its provider. */
export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return context;
}
