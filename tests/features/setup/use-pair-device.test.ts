import { renderHook, act } from '@testing-library/react-native';
import { bridgeClient } from '../../../src/infrastructure/api';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as initialSyncHelpers from '../../../src/features/sync/initial-sync.helpers';
import { usePairDevice } from '../../../src/features/setup/use-pair-device';

jest.mock('../../../src/infrastructure/api', () => ({
  bridgeClient: {
    pairDevice: jest.fn(),
  },
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
  getExpoSQLiteUnavailableError: jest.fn(() => new Error('sqlite unavailable')),
}));

jest.mock('../../../src/features/sync/initial-sync.helpers', () => ({
  fetchInitialSyncSnapshot: jest.fn(),
  persistPairedBridgeConfiguration: jest.fn(),
}));

describe('usePairDevice', () => {
  const rawDb = { name: 'raw-db' };
  const pairDeviceMock = bridgeClient.pairDevice as jest.Mock;

  function pairResponse(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 201,
      data: {
        device_id: 'dev-123',
        device_name: 'My Bridge',
        auth_token: 'auth-secret',
      },
      rawBody: '{}',
      url: 'http://192.168.1.10:8080/api/devices/pair',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (initialSyncHelpers.fetchInitialSyncSnapshot as jest.Mock).mockResolvedValue([]);
    (initialSyncHelpers.persistPairedBridgeConfiguration as jest.Mock).mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('R3: should return success and save config on 200/201 response', async () => {
    pairDeviceMock.mockResolvedValueOnce(pairResponse());

    const { result } = renderHook(() => usePairDevice());

    let pairResult: { success: boolean; data?: any; error?: string } | undefined = undefined;
    await act(async () => {
      pairResult = await result.current.pair({ ip: '192.168.1.10', port: '8080', token: 'pairing123' });
    });

    expect(pairResult).toEqual({
      success: true,
      data: {
        device_id: 'dev-123',
        device_name: 'My Bridge',
        auth_token: 'auth-secret',
      },
    });

    expect(pairDeviceMock).toHaveBeenCalledWith(
      { ip: '192.168.1.10', port: 8080 },
      { pairingToken: 'pairing123', deviceName: 'AutoreasMobile' },
    );

    expect(initialSyncHelpers.fetchInitialSyncSnapshot).toHaveBeenCalledWith({
      ip: '192.168.1.10',
      port: 8080,
      token: 'auth-secret',
      deviceId: 'dev-123',
      deviceName: 'My Bridge',
    });
    expect(initialSyncHelpers.persistPairedBridgeConfiguration).toHaveBeenCalledWith(
      rawDb,
      {
        ip: '192.168.1.10',
        port: 8080,
        token: 'auth-secret',
        deviceId: 'dev-123',
        deviceName: 'My Bridge',
      },
      [],
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('R4: should return error and NOT save config on 400 response', async () => {
    pairDeviceMock.mockResolvedValueOnce(
      pairResponse({ ok: false, status: 400, data: null, rawBody: null }),
    );

    const { result } = renderHook(() => usePairDevice());

    let pairResult: { success: boolean; data?: any; error?: string } | undefined = undefined;
    await act(async () => {
      pairResult = await result.current.pair({ ip: '192.168.1.10', port: '8080', token: 'invalid' });
    });

    expect(pairResult).toEqual({
      success: false,
      error: 'No pudimos emparejar el dispositivo. Revisá la IP, el puerto y el token del Bridge.',
    });

    expect(initialSyncHelpers.fetchInitialSyncSnapshot).not.toHaveBeenCalled();
    expect(initialSyncHelpers.persistPairedBridgeConfiguration).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(
      'No pudimos emparejar el dispositivo. Revisá la IP, el puerto y el token del Bridge.',
    );
  });

  it('should expose a friendly retry message when auth_token is missing', async () => {
    pairDeviceMock.mockResolvedValueOnce(
      pairResponse({ data: { device_id: 'dev-123', device_name: 'Missing fields' } }),
    );

    const { result } = renderHook(() => usePairDevice());

    let pairResult: { success: boolean; data?: any; error?: string } | undefined = undefined;
    await act(async () => {
      pairResult = await result.current.pair({ ip: '1.1.1.1', port: 80, token: 'xxx' });
    });

    expect(pairResult).toEqual({
      success: false,
      error: 'El Bridge respondió con datos incompletos. Volvé a generar el token e intentá de nuevo.',
    });

    expect(pairDeviceMock).toHaveBeenCalledWith(
      { ip: '1.1.1.1', port: 80 },
      { pairingToken: 'xxx', deviceName: 'AutoreasMobile' },
    );
    expect(initialSyncHelpers.fetchInitialSyncSnapshot).not.toHaveBeenCalled();
    expect(initialSyncHelpers.persistPairedBridgeConfiguration).not.toHaveBeenCalled();
  });

  it('does not persist partial bridge config when initial sync fails after pair success', async () => {
    pairDeviceMock.mockResolvedValueOnce(pairResponse());
    (initialSyncHelpers.fetchInitialSyncSnapshot as jest.Mock).mockRejectedValueOnce(
      new Error('GET /api/animes failed: 500'),
    );

    const { result } = renderHook(() => usePairDevice());

    let pairResult:
      | { success: boolean; data?: unknown; error?: string }
      | undefined = undefined;

    await act(async () => {
      pairResult = await result.current.pair({
        ip: '192.168.1.10',
        port: '8080',
        token: 'pairing123',
      });
    });

    expect(pairResult).toEqual({
      success: false,
      error: 'Se completó el emparejamiento, pero falló la sincronización inicial. Intentá nuevamente en unos segundos.',
    });
    expect(initialSyncHelpers.persistPairedBridgeConfiguration).not.toHaveBeenCalled();
  });

  it('shows token guidance when initial sync fails with 401 after pair success', async () => {
    pairDeviceMock.mockResolvedValueOnce(pairResponse());
    (initialSyncHelpers.fetchInitialSyncSnapshot as jest.Mock).mockRejectedValueOnce(
      new Error('GET /api/animes failed: 401'),
    );

    const { result } = renderHook(() => usePairDevice());

    let pairResult:
      | { success: boolean; data?: unknown; error?: string }
      | undefined = undefined;

    await act(async () => {
      pairResult = await result.current.pair({
        ip: '192.168.1.10',
        port: '8080',
        token: 'pairing123',
      });
    });

    expect(pairResult).toEqual({
      success: false,
      error:
        'Se completó el emparejamiento, pero el Bridge rechazó la sincronización inicial. Volvé a generar el token e intentá de nuevo.',
    });
    expect(initialSyncHelpers.persistPairedBridgeConfiguration).not.toHaveBeenCalled();
  });
});
