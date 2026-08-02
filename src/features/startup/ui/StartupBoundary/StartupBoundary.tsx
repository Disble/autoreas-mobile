import type { StartupBoundaryViewProps } from './startup-boundary.types';

/** Renders the startup boundary interface. */
export function StartupBoundaryView(props: Readonly<StartupBoundaryViewProps>) {
  return <>{props.rootContent}</>;
}
