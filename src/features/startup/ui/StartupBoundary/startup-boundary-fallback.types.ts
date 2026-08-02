import type { StartupFailure } from '../../startup.types';

/** Defines the app root layout startup fallback props value shape. */
export interface StartupBoundaryFallbackProps {
  readonly failure: StartupFailure;
}
