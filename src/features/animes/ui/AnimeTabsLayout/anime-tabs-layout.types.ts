import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';

/** Defines the anime tabs layout props value shape. */
export type AnimeTabsLayoutProps = Record<never, never>;

/**
 * Stack options this layout hands to expo-router's `Stack`.
 *
 * Derived from the installed navigator rather than restated by hand, so the
 * layout cannot drift from the shape React Navigation actually accepts. The
 * function form is excluded on purpose: this layout only ever passes objects.
 */
export type AnimeTabsLayoutScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>['screenOptions']>,
  (...args: never[]) => unknown
>;

/** Defines the data contract for anime tabs layout view model. */
export interface AnimeTabsLayoutViewModel {
  readonly screenOptions: AnimeTabsLayoutScreenOptions;
  readonly settingsScreenOptions: AnimeTabsLayoutScreenOptions;
}
