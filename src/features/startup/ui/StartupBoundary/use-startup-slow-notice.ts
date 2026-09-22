import { useEffect, useState } from 'react';
import { STARTUP_SOFT_DEADLINE_MS } from '../../startup.constants';
import type { StartupFailure } from '../../startup.types';

/** Defines the guard inputs that gate the soft-deadline observation. */
export interface UseStartupSlowNoticeParams {
  readonly existingStartupFailure: StartupFailure | null;
  readonly fontsLoaded: boolean;
  readonly hasSQLiteProvider: boolean;
  readonly isReady: boolean;
}

/**
 * Observes whether normal startup stays Suspense-stalled past the soft deadline.
 *
 * The flag only arms once fonts are loaded, a SQLite provider exists, startup is not ready, and
 * no earlier terminal failure exists: a missing provider or an existing failure already renders
 * its own dedicated screen, so the soft deadline measures only the Suspense-stalled readiness
 * window. The cleanup clears both the pending timer and the flag so a late recovery returns the
 * loading placeholder to its prompt state.
 */
export function useStartupSlowNotice(params: Readonly<UseStartupSlowNoticeParams>): boolean {
  const { existingStartupFailure, fontsLoaded, hasSQLiteProvider, isReady } = params;

  const [hasExceededSoftDeadline, setHasExceededSoftDeadline] = useState(false);

  useEffect(() => {
    if (!fontsLoaded || !hasSQLiteProvider || isReady || existingStartupFailure) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHasExceededSoftDeadline(true);
    }, STARTUP_SOFT_DEADLINE_MS);

    return () => {
      clearTimeout(timeoutId);
      setHasExceededSoftDeadline(false);
    };
  }, [existingStartupFailure, fontsLoaded, hasSQLiteProvider, isReady]);

  return hasExceededSoftDeadline;
}
