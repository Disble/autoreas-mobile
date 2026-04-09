import React, { createContext, useCallback, useContext, useMemo } from "react";
import { Uniwind, useUniwind } from "uniwind";

type ThemeName =
  | "light"
  | "dark"
  | "lavender-light"
  | "lavender-dark"
  | "mint-light"
  | "mint-dark"
  | "sky-light"
  | "sky-dark";

interface AppThemeContextType {
  currentTheme: string;
  isLight: boolean;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

const AppThemeContext = createContext<AppThemeContextType | undefined>(
  undefined,
);

const THEME_TOGGLE_MAP: Record<ThemeName, ThemeName> = {
  light: "dark",
  dark: "light",
  "lavender-light": "lavender-dark",
  "lavender-dark": "lavender-light",
  "mint-light": "mint-dark",
  "mint-dark": "mint-light",
  "sky-light": "sky-dark",
  "sky-dark": "sky-light",
};

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { theme } = useUniwind();

  const isLight = useMemo(() => {
    return theme === "light" || theme.endsWith("-light");
  }, [theme]);

  const isDark = useMemo(() => {
    return theme === "dark" || theme.endsWith("-dark");
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    Uniwind.setTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = THEME_TOGGLE_MAP[theme as ThemeName];
    if (next) {
      Uniwind.setTheme(next);
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      currentTheme: theme,
      isLight,
      isDark,
      setTheme,
      toggleTheme,
    }),
    [theme, isLight, isDark, setTheme, toggleTheme],
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
};

export const useAppTheme = () => {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
};
