import { act, renderHook } from '@testing-library/react-native';
import { useStartup } from '../../../../src/features/startup/use-startup';
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
});
