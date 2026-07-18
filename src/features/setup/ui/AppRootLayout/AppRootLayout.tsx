import type { AppRootLayoutViewProps } from './app-root-layout.types';

/** Renders the app root layout interface. */
export function AppRootLayoutView(props: Readonly<AppRootLayoutViewProps>) {
  return props.rootContent;
}
