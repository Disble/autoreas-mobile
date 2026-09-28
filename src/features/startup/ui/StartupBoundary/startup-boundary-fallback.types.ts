import type { StartupFailure } from '../../startup.types';
import type { StartupBoundaryRecovery } from './startup-boundary.types';

/** Defines the app root layout startup fallback props value shape. */
export interface StartupBoundaryFallbackProps {
  readonly failure: StartupFailure;
  /** Carries the renderable recovery presentation, or `null` when this failure has none. */
  readonly recovery: StartupBoundaryRecovery | null;
}
