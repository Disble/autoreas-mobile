import type { ReactNode } from 'react';

/** Props of the root wrapper that watches how fast the screen paints. */
export interface ScreenStallProbeProps {
  /** The whole app; the wrapper only observes the touches that reach it. */
  readonly children?: ReactNode;
}
