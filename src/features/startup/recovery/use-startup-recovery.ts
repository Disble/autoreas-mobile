import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createDatabaseResetOrchestrator } from '../../../infrastructure/db/recovery/recovery.helpers';
import type {
  DatabaseResetOutcome,
  ResetDecisionInput,
} from '../../../infrastructure/db/recovery/recovery.types';
import { createDatabaseResetAdapters } from '../../../infrastructure/db/recovery/recovery.adapters';
import { useOptionalSQLiteContext } from '../../../infrastructure/db/native-runtime/native-runtime.helpers';
import {
  createInitialStartupResetAttempt,
  createStartupRecoveryState,
} from './recovery.helpers';
import type {
  StartupResetAttempt,
  UseStartupRecoveryProps,
  UseStartupRecoveryResult,
} from './recovery.types';

/**
 * Owns the startup recovery decisions and the reset orchestration of one startup attempt.
 *
 * The hook renders nothing and holds no presentation copy: every state it exposes comes from the
 * pure presentation helper, so the view layer only has to render what the logic authorized. It
 * owns four things the pure logic cannot: the attempt bookkeeping, the single-flight guard that
 * makes a double press harmless, the production orchestrator invocation, and the signals the
 * caller needs to remount a genuinely fresh provider.
 *
 * There is deliberately no effect here. Nothing in this flow happens on its own: a reset runs only
 * from an explicit confirmation, and a retry only from an explicit action, which is what keeps a
 * destructive operation out of a render or mount path.
 */
export function useStartupRecovery(
  props: Readonly<UseStartupRecoveryProps>,
): UseStartupRecoveryResult {
  const { cause, getActiveDatabase, openAppSettings, remountProvider, runDatabaseReset } = props;

  // 1. Refs
  const inFlightResetRef = useRef<Promise<void> | null>(null);

  // 2. State
  const [attempt, setAttempt] = useState<StartupResetAttempt>(createInitialStartupResetAttempt);
  const [isResetConfirmationVisible, setIsResetConfirmationVisible] = useState(false);

  // 3. Context/3rd Party Hooks
  const contextDatabase = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const resolveActiveDatabase = useCallback(
    (): SQLiteDatabase | null =>
      getActiveDatabase === undefined ? contextDatabase : getActiveDatabase(),
    [contextDatabase, getActiveDatabase],
  );
  const runReset = useCallback(
    (input: ResetDecisionInput): Promise<DatabaseResetOutcome> => {
      if (runDatabaseReset !== undefined) {
        return runDatabaseReset(input);
      }

      return createDatabaseResetOrchestrator(
        createDatabaseResetAdapters({ getActiveDatabase: resolveActiveDatabase }),
      ).run(input);
    },
    [resolveActiveDatabase, runDatabaseReset],
  );

  // 5. Derived State (`useMemo`)
  // The provider remount the caller promises is what makes a retry do real work, so the promise
  // itself is the input the presentation reads; there is no separate flag to keep in sync.
  const canMountFreshProvider = remountProvider !== undefined;
  const recoveryState = useMemo(
    () => createStartupRecoveryState({ attempt, canMountFreshProvider, cause }),
    [attempt, canMountFreshProvider, cause],
  );
  const classification = cause?.kind === 'startup_failure' ? cause.classification : null;

  // 6. Callbacks (`useCallback` calling pure helpers)
  const requestReset = useCallback((): void => {
    if (recoveryState.kind !== 'damage') {
      return;
    }

    setIsResetConfirmationVisible(true);
  }, [recoveryState.kind]);

  const cancelReset = useCallback((): void => {
    setIsResetConfirmationVisible(false);
    setAttempt({ status: 'declined' });
  }, []);

  const startReset = useCallback(async (): Promise<void> => {
    if (classification === null) {
      return;
    }

    // Single flight: a second press joins the run already in progress instead of starting another
    // deletion. The ref is read and written in the same tick, so two presses cannot both pass it,
    // and it is released only once the operation settles either way.
    const inFlightReset = inFlightResetRef.current;

    if (inFlightReset !== null) {
      await inFlightReset;
      return;
    }

    setIsResetConfirmationVisible(false);
    setAttempt({ status: 'in_flight' });

    const operation = (async (): Promise<void> => {
      let outcome: DatabaseResetOutcome;

      try {
        outcome = await runReset({ classification });
      } catch {
        // A runner that rejects reported no stage at all, so it is reported as unexplained
        // instead of invented. It is never treated as a completed reset.
        setAttempt({ reason: { kind: 'unexpected' }, status: 'failed' });
        return;
      }

      if (outcome.status === 'completed') {
        setAttempt({ status: 'completed' });
        remountProvider?.();
        return;
      }

      setAttempt({
        reason:
          outcome.status === 'refused'
            ? { kind: 'refused', reason: outcome.reason }
            : { kind: 'stage', stage: outcome.stage },
        status: 'failed',
      });
    })();

    inFlightResetRef.current = operation;

    try {
      await operation;
    } finally {
      inFlightResetRef.current = null;
    }
  }, [classification, remountProvider, runReset]);

  const confirmReset = useCallback(async (): Promise<void> => {
    if (recoveryState.kind !== 'damage' || !isResetConfirmationVisible) {
      return;
    }

    await startReset();
  }, [isResetConfirmationVisible, recoveryState.kind, startReset]);

  const retryReset = useCallback(async (): Promise<void> => {
    if (recoveryState.kind !== 'reset_failed') {
      return;
    }

    await startReset();
  }, [recoveryState.kind, startReset]);

  const retryStartup = useCallback((): void => {
    if (!canMountFreshProvider) {
      return;
    }

    setAttempt(createInitialStartupResetAttempt());
    remountProvider?.();
  }, [canMountFreshProvider, remountProvider]);

  const handleOpenAppSettings = useCallback(async (): Promise<void> => {
    if (openAppSettings !== undefined) {
      await openAppSettings();
      return;
    }

    await Linking.openSettings();
  }, [openAppSettings]);

  // 7. Effects -- none: every state change is driven by an explicit user action.

  return {
    cancelReset,
    confirmReset,
    isResetConfirmationVisible,
    openAppSettings: handleOpenAppSettings,
    recoveryState,
    requestReset,
    retryReset,
    retryStartup,
  };
}
