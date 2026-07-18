import { createElement } from 'react';
import { AppRootLayoutView } from './AppRootLayout';
import type { AppRootLayoutProps } from './app-root-layout.types';
import { useAppRootLayout } from './use-app-root-layout';

/** Composes the app root layout behavior with its render-only view. */
export function AppRootLayout(props: Readonly<AppRootLayoutProps>) {
  const { rootContent } = useAppRootLayout(props);

  return createElement(AppRootLayoutView, { rootContent });
}
