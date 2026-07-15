/** Defines the anime tabs layout props value shape. */
export type AnimeTabsLayoutProps = Record<never, never>;

/** Defines the data contract for anime tabs layout view model. */
export interface AnimeTabsLayoutViewModel {
  readonly headerBackgroundColor: string | undefined;
  readonly isDark: boolean;
  readonly themeColorBackground: string;
  readonly themeColorForeground: string;
}
