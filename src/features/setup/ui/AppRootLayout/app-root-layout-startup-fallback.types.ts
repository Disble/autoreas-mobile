import type { BootstrapFailure } from '../../db-bootstrap.types';

/** Defines the app root layout startup fallback props value shape. */
export interface AppRootLayoutStartupFallbackProps {
  readonly failure: BootstrapFailure;
}
