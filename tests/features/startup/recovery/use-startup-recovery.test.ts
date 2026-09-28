import { act, renderHook } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  useStartupRecovery,
  type StartupRecoveryCause,
} from '../../../../src/features/startup/recovery';
import {
  createDatabaseResetAdapters,
} from '../../../../src/infrastructure/db/recovery/recovery.adapters';
import type {
  DatabaseResetOutcome,
  DatabaseResetPorts,
} from '../../../../src/infrastructure/db/recovery';
import { useOptionalSQLiteContext } from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../../src/infrastructure/db/recovery/recovery.adapters', () => ({
  createDatabaseResetAdapters: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

/** Exposes the adapters factory as a mock so each test installs its own fake ports. */
const createDatabaseResetAdaptersMock = createDatabaseResetAdapters as jest.Mock;
/** Reports no provider connection, which is what a recovery surface outside the provider sees. */
const useOptionalSQLiteContextMock = useOptionalSQLiteContext as jest.Mock;

/** Names the only startup failure that authorizes a destructive reset. */
const CORRUPTION_CAUSE: StartupRecoveryCause = {
  classification: 'corruption',
  kind: 'startup_failure',
};

/** Names a transient startup failure the user may retry. */
const BUSY_CAUSE: StartupRecoveryCause = { classification: 'busy', kind: 'startup_failure' };

/** Names a startup failure that must never authorize a reset. */
const SQLITE_CAUSE: StartupRecoveryCause = { classification: 'sqlite', kind: 'startup_failure' };

/** Builds a complete fake port set so the real orchestrator can run against it. */
function createFakePorts(overrides: Partial<DatabaseResetPorts> = {}): DatabaseResetPorts {
  return {
    clearResetIntent: jest.fn(async () => undefined),
    closeDatabaseConnections: jest.fn(async () => undefined),
    deleteDatabase: jest.fn(async () => undefined),
    isDatabasePresent: jest.fn(async () => true),
    now: jest.fn(() => 1_700_000_000_000),
    openAndPrepare: jest.fn(async () => undefined),
    readResetIntent: jest.fn(async () => null),
    stopNativeWriters: jest.fn(async () => undefined),
    writeResetIntent: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** Holds a reset in flight so a test can observe the state before it settles. */
function createDeferredOutcome() {
  let settle!: (outcome: DatabaseResetOutcome) => void;
  const promise = new Promise<DatabaseResetOutcome>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/** Builds a fake provider connection with the one member the close port uses. */
function createFakeDatabase(): SQLiteDatabase {
  return { closeAsync: jest.fn(async () => undefined) } as unknown as SQLiteDatabase;
}

describe('useStartupRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOptionalSQLiteContextMock.mockReturnValue(null);
    createDatabaseResetAdaptersMock.mockReturnValue(createFakePorts());
  });

  it('runs one reset for a double press and keeps the in-flight state until it settles', async () => {
    const deferred = createDeferredOutcome();
    const remountProvider = jest.fn();
    const runDatabaseReset = jest.fn(() => deferred.promise);
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, remountProvider, runDatabaseReset }),
    );

    act(() => {
      result.current.requestReset();
    });

    expect(result.current.isResetConfirmationVisible).toBe(true);

    let firstPress!: Promise<void>;
    let secondPress!: Promise<void>;

    await act(async () => {
      firstPress = result.current.confirmReset();
      secondPress = result.current.confirmReset();
    });

    expect(runDatabaseReset).toHaveBeenCalledTimes(1);
    expect(runDatabaseReset).toHaveBeenCalledWith({ classification: 'corruption' });
    expect(result.current.recoveryState.kind).toBe('resetting');
    expect(remountProvider).not.toHaveBeenCalled();

    await act(async () => {
      deferred.settle({ deleted: true, status: 'completed' });
      await Promise.all([firstPress, secondPress]);
    });

    expect(result.current.recoveryState.kind).toBe('reset_completed');
    expect(remountProvider).toHaveBeenCalledTimes(1);
  });

  it('never runs a reset without the explicit confirmation of the visible offer', async () => {
    const runDatabaseReset = jest.fn(
      async (): Promise<DatabaseResetOutcome> => ({ deleted: true, status: 'completed' }),
    );
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, runDatabaseReset }),
    );

    await act(async () => {
      await result.current.confirmReset();
    });

    expect(runDatabaseReset).not.toHaveBeenCalled();

    act(() => {
      result.current.requestReset();
    });
    act(() => {
      result.current.cancelReset();
    });

    await act(async () => {
      await result.current.confirmReset();
    });

    expect(runDatabaseReset).not.toHaveBeenCalled();
    expect(result.current.isResetConfirmationVisible).toBe(false);
    expect(result.current.recoveryState.kind).toBe('no_reset');
  });

  it('never runs a reset when the startup failure did not authorize one', async () => {
    const runDatabaseReset = jest.fn(
      async (): Promise<DatabaseResetOutcome> => ({ deleted: true, status: 'completed' }),
    );
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: SQLITE_CAUSE, runDatabaseReset }),
    );

    act(() => {
      result.current.requestReset();
    });

    expect(result.current.isResetConfirmationVisible).toBe(false);
    expect(result.current.recoveryState.kind).toBe('no_reset');

    await act(async () => {
      await result.current.confirmReset();
    });

    expect(runDatabaseReset).not.toHaveBeenCalled();
  });

  it('reports a failed reset, remounts nothing until it succeeds, and retries it from the failed state', async () => {
    const remountProvider = jest.fn();
    const runDatabaseReset = jest
      .fn<Promise<DatabaseResetOutcome>, [unknown]>()
      .mockResolvedValueOnce({ stage: 'database_delete', status: 'failed' })
      .mockResolvedValueOnce({ deleted: true, status: 'completed' });
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, remountProvider, runDatabaseReset }),
    );

    act(() => {
      result.current.requestReset();
    });

    await act(async () => {
      await result.current.confirmReset();
    });

    expect(result.current.recoveryState).toMatchObject({
      failureReason: { kind: 'stage', stage: 'database_delete' },
      kind: 'reset_failed',
    });
    expect(remountProvider).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryReset();
    });

    expect(runDatabaseReset).toHaveBeenCalledTimes(2);
    expect(result.current.recoveryState.kind).toBe('reset_completed');
    expect(remountProvider).toHaveBeenCalledTimes(1);
  });

  it('never presents a refused or an unexplained reset as a completed one', async () => {
    const refused = jest.fn(
      async (): Promise<DatabaseResetOutcome> => ({ reason: 'sqlite', status: 'refused' }),
    );
    const refusedHook = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, runDatabaseReset: refused }),
    );

    act(() => {
      refusedHook.result.current.requestReset();
    });
    await act(async () => {
      await refusedHook.result.current.confirmReset();
    });

    expect(refusedHook.result.current.recoveryState).toMatchObject({
      failureReason: { kind: 'refused', reason: 'sqlite' },
      kind: 'reset_failed',
    });

    const rejected = jest.fn(async (): Promise<DatabaseResetOutcome> => {
      throw new Error('adapter exploded');
    });
    const rejectedHook = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, runDatabaseReset: rejected }),
    );

    act(() => {
      rejectedHook.result.current.requestReset();
    });
    await act(async () => {
      await rejectedHook.result.current.confirmReset();
    });

    expect(rejectedHook.result.current.recoveryState).toMatchObject({
      failureReason: { kind: 'unexpected' },
      kind: 'reset_failed',
    });
    expect(rejectedHook.result.current.recoveryState.kind).not.toBe('reset_completed');
  });

  it('offers the transient retry only through the injected fresh-provider remount', async () => {
    const remountProvider = jest.fn();
    const retryable = renderHook(() =>
      useStartupRecovery({ cause: BUSY_CAUSE, remountProvider }),
    );

    expect(retryable.result.current.recoveryState).toMatchObject({
      kind: 'transient',
      retryActionLabel: expect.any(String),
    });

    act(() => {
      retryable.result.current.retryStartup();
    });

    expect(remountProvider).toHaveBeenCalledTimes(1);
    expect(retryable.result.current.recoveryState).toMatchObject({ kind: 'transient' });

    const notRetryable = renderHook(() => useStartupRecovery({ cause: BUSY_CAUSE }));

    expect(notRetryable.result.current.recoveryState).toMatchObject({
      kind: 'transient',
      retryActionLabel: null,
    });

    act(() => {
      notRetryable.result.current.retryStartup();
    });

    expect(notRetryable.result.current.recoveryState).toMatchObject({
      kind: 'transient',
      retryActionLabel: null,
    });
  });

  it('runs the production orchestrator over the injected adapters when no runner is provided', async () => {
    const ports = createFakePorts();
    const liveDatabase = createFakeDatabase();
    const remountProvider = jest.fn();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    useOptionalSQLiteContextMock.mockReturnValue(liveDatabase);
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, remountProvider }),
    );

    act(() => {
      result.current.requestReset();
    });

    await act(async () => {
      await result.current.confirmReset();
    });

    expect(createDatabaseResetAdaptersMock).toHaveBeenCalledTimes(1);
    const adapterParams = createDatabaseResetAdaptersMock.mock.calls[0][0] as {
      readonly getActiveDatabase: () => unknown;
    };

    expect(adapterParams.getActiveDatabase()).toBe(liveDatabase);
    expect(ports.readResetIntent).toHaveBeenCalledTimes(1);
    expect(ports.writeResetIntent).toHaveBeenCalledWith({
      reason: 'confirmed_corruption',
      requestedAt: 1_700_000_000_000,
    });
    expect(ports.stopNativeWriters).toHaveBeenCalledTimes(1);
    expect(ports.closeDatabaseConnections).toHaveBeenCalledTimes(1);
    expect(ports.isDatabasePresent).toHaveBeenCalledTimes(1);
    expect(ports.deleteDatabase).toHaveBeenCalledWith('autoreas.db');
    expect(ports.openAndPrepare).toHaveBeenCalledTimes(1);
    expect(ports.clearResetIntent).toHaveBeenCalledTimes(1);
    expect(result.current.recoveryState.kind).toBe('reset_completed');
    expect(remountProvider).toHaveBeenCalledTimes(1);
  });

  it('prefers a caller-supplied live connection over the provider context', async () => {
    const ports = createFakePorts();
    const callerDatabase = createFakeDatabase();
    const contextDatabase = createFakeDatabase();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    useOptionalSQLiteContextMock.mockReturnValue(contextDatabase);
    const { result } = renderHook(() =>
      useStartupRecovery({ cause: CORRUPTION_CAUSE, getActiveDatabase: () => callerDatabase }),
    );

    act(() => {
      result.current.requestReset();
    });

    await act(async () => {
      await result.current.confirmReset();
    });

    const adapterParams = createDatabaseResetAdaptersMock.mock.calls[0][0] as {
      readonly getActiveDatabase: () => unknown;
    };

    expect(adapterParams.getActiveDatabase()).toBe(callerDatabase);
  });

  it('opens the app settings through the injected opener and through the platform link by default', async () => {
    const openAppSettings = jest.fn(async () => undefined);
    const injected = renderHook(() => useStartupRecovery({ cause: null, openAppSettings }));

    await act(async () => {
      await injected.result.current.openAppSettings();
    });

    expect(openAppSettings).toHaveBeenCalledTimes(1);

    const openSettingsSpy = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);
    const defaulted = renderHook(() => useStartupRecovery({ cause: null }));

    await act(async () => {
      await defaulted.result.current.openAppSettings();
    });

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    openSettingsSpy.mockRestore();
  });
});
