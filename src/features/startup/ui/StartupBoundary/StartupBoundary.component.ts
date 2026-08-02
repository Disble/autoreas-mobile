import { createElement } from 'react';
import { StartupBoundaryView } from './StartupBoundary';
import type { StartupBoundaryProps } from './startup-boundary.types';
import { useStartupBoundary } from './use-startup-boundary';

/** Composes application startup behavior with its render-only view. */
export function StartupBoundary(props: Readonly<StartupBoundaryProps>) {
  const { rootContent } = useStartupBoundary(props);

  return createElement(StartupBoundaryView, { rootContent });
}
