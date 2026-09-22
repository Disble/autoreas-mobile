import { act, renderHook } from '@testing-library/react-native';
import { useStartup } from '../../../../src/features/startup/use-startup';
import {
  STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS,
  STARTUP_LOCAL_OPERATION_DEADLINE_MS,
} from '../../../../src/features/startup/startup.constants';
import { getBridgeConfigSnapshot } from '../../../../src/infrastructure/db/client/client.helpers';
import { prepareForegroundDatabase } from '../../../../src/infrastructure/db/startup/startup.helpers';
import { getSQLiteProvider } from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/startup/startup.helpers', () => ({
  prepareForegroundDatabase: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getSQLiteProvider: jest.fn(),
}));

describe('useStartup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // `clearAllMocks` keeps queued `mock*Once` behaviors; the retry tests queue them, so they
    // must be reset too or they leak into the next test's preparation mock.
    jest.resetAllMocks();
    (getSQLiteProvider as jest.Mock).mockReturnValue('SQLiteProvider');
    (prepareForegroundDatabase as jest.Mock).mockResolvedValue(undefined);
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({ deviceId: 'device-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('becomes ready only after foreground schema preparation and local config loading', async () => {
    const rawDb = { id: 'raw-db' };
    const { result } = renderHook(() => useStartup());

    await act(async () => {
      await result.current.handleDatabaseInit(rawDb as never);
    });

    expect(prepareForegroundDatabase).toHaveBeenCalledWith(rawDb);
    expect(getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect((prepareForegroundDatabase as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (getBridgeConfigSnapshot as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(result.current.startupState).toEqual({
      failure: null,
      phase: 'ready',
      target: '/(tabs)',
    });

    expect(result.current.isReady).toBe(true);
  });

  it('enters controlled fatal state with redacted diagnostics when database preparation fails', async () => {
    // A persistent busy rejection is now RETRYABLE: the preparation loop burns its bounded
    // attempts (see STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS) before this fatal state renders.
    const nativeFailure = new Error(
      'SQLITE_BUSY: UPDATE bridge_config token=secret at 192.168.1.10',
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (prepareForegroundDatabase as jest.Mock).mockRejectedValue(nativeFailure);
    const { result } = renderHook(() => useStartup());

    await act(async () => {
      await result.current.handleDatabaseInit({} as never);
    });

    expect(getBridgeConfigSnapshot).not.toHaveBeenCalled();
    expect(result.current.isReady).toBe(false);
    expect(result.current.startupState).toEqual({
      failure: {
        diagnostic: {
          stage: 'database_preparation',
          code: 'SQLITE_BUSY',
          classification: 'busy',
        },
        diagnosticMessage: 'Error al preparar la base local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      phase: 'fatal',
      target: null,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('192.168.1.10');
    consoleError.mockRestore();
  });

  it('retries a transient SQLITE_BUSY preparation failure and becomes ready on the second attempt', async () => {
    (prepareForegroundDatabase as jest.Mock)
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useStartup());

    await act(async () => {
      await result.current.handleDatabaseInit({} as never);
    });

    expect(prepareForegroundDatabase).toHaveBeenCalledTimes(2);
    expect(result.current.startupState).toEqual({
      failure: null,
      phase: 'ready',
      target: '/(tabs)',
    });
  });

  it('never retries a permanent schema validation failure and goes fatal after exactly one attempt', async () => {
    // `createStartupDiagnostic` classifies by error name: this is the exact shape the code
    // already maps to the non-retryable `schema_validation` classification.
    const schemaFailure = new Error('foreign key mismatch in operation_log');
    schemaFailure.name = 'SchemaValidationError';
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (prepareForegroundDatabase as jest.Mock).mockRejectedValue(schemaFailure);
    const { result } = renderHook(() => useStartup());

    await act(async () => {
      await result.current.handleDatabaseInit({} as never);
    });

    expect(prepareForegroundDatabase).toHaveBeenCalledTimes(1);
    expect(result.current.startupState).toEqual({
      failure: {
        diagnostic: {
          stage: 'database_preparation',
          code: null,
          classification: 'schema_validation',
        },
        diagnosticMessage: 'Error al preparar la base local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      phase: 'fatal',
      target: null,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'foreign key mismatch in operation_log',
    );
    consoleError.mockRestore();
  });

  it('stops at the bounded attempt cap when a transient lock keeps failing and goes fatal with the redacted busy diagnostic', async () => {
    (prepareForegroundDatabase as jest.Mock).mockRejectedValue(
      new Error('SQLITE_BUSY: database is locked'),
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useStartup());

    await act(async () => {
      await result.current.handleDatabaseInit({} as never);
    });

    expect(prepareForegroundDatabase).toHaveBeenCalledTimes(
      STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS,
    );
    expect(result.current.startupState.failure?.diagnostic).toEqual({
      stage: 'database_preparation',
      code: 'SQLITE_BUSY',
      classification: 'busy',
    });
    expect(result.current.startupState.phase).toBe('fatal');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('database is locked');
    consoleError.mockRestore();
  });

  it('enters controlled fatal state when database preparation does not settle before the local startup deadline', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (prepareForegroundDatabase as jest.Mock).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const { result } = renderHook(() => useStartup());

    result.current.handleDatabaseInit({} as never).catch(() => undefined);

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.startupState).toEqual({
      failure: {
        diagnostic: {
          stage: 'database_preparation',
          code: null,
          classification: 'unknown',
        },
        diagnosticMessage: 'Error al preparar la base local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      phase: 'fatal',
      target: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[startup] Local readiness failed',
      expect.objectContaining({ stage: 'database_preparation' }),
    );
    consoleError.mockRestore();
  });

  it('enters controlled fatal state when local config loading does not settle before the local startup deadline', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (getBridgeConfigSnapshot as jest.Mock).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const { result } = renderHook(() => useStartup());

    result.current.handleDatabaseInit({} as never).catch(() => undefined);

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.startupState).toEqual({
      failure: {
        diagnostic: {
          stage: 'local_config',
          code: null,
          classification: 'unknown',
        },
        diagnosticMessage: 'Error al leer la configuración local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      phase: 'fatal',
      target: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[startup] Local readiness failed',
      expect.objectContaining({ stage: 'local_config' }),
    );
    consoleError.mockRestore();
  });

  it('keeps newer ready state when a superseded database preparation later reaches its deadline', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (prepareForegroundDatabase as jest.Mock)
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useStartup());

    result.current.handleDatabaseInit({ id: 'stale-db' } as never).catch(() => undefined);

    await act(async () => {
      await result.current.handleDatabaseInit({ id: 'current-db' } as never);
    });

    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });

    expect(result.current.startupState).toEqual({
      failure: null,
      phase: 'ready',
      target: '/(tabs)',
    });
    consoleError.mockRestore();
  });

  it('spends one shared local budget across preparation and the local configuration read so no fresh budget starts after preparation', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Database preparation consumes half of the shared local budget before settling...
    (prepareForegroundDatabase as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(resolve, STARTUP_LOCAL_OPERATION_DEADLINE_MS / 2),
        ),
    );
    // ...and the local configuration read then hangs for the rest of the budget.
    (getBridgeConfigSnapshot as jest.Mock).mockImplementation(
      () => new Promise<never>(() => undefined),
    );
    const { result } = renderHook(() => useStartup());

    result.current.handleDatabaseInit({} as never).catch(() => undefined);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_LOCAL_OPERATION_DEADLINE_MS / 2);
    });

    // Preparation settled inside the shared budget; the configuration read is in flight.
    expect(result.current.startupState.phase).toBe('loading_config');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_LOCAL_OPERATION_DEADLINE_MS / 2);
    });

    // The fatal card must arrive when the SHARED local budget is exhausted, not when a fresh
    // full allowance granted to the configuration read after preparation would expire: with a
    // fresh per-operation budget the read would still be inside its own budget at this point
    // and the false-fatal class this contract forbids would reappear.
    expect(result.current.startupState).toEqual({
      failure: {
        diagnostic: {
          stage: 'local_config',
          code: null,
          classification: 'unknown',
        },
        diagnosticMessage: 'Error al leer la configuración local durante el inicio.',
        recoveryHint:
          'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
      },
      phase: 'fatal',
      target: null,
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[startup] Local readiness failed',
      expect.objectContaining({ stage: 'local_config' }),
    );
    consoleError.mockRestore();
  });
});
