import { act, renderHook } from '@testing-library/react-native';
import { useBridgeConfig } from '../../../src/features/settings/use-bridge-config';
import {
  clearBridgeConfig,
  createDrizzleDb,
} from '../../../src/infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  clearBridgeConfig: jest.fn(),
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useBridgeConfig', () => {
  const rawDb = { id: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    const queryBuilder = {
      from: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue({ query: 'bridge-config' }),
    };

    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue(queryBuilder),
    });
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({ data: [] });
  });

  it('retorna config cuando hay bridgeConfig en SQLite', () => {
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({
      data: [
        {
          id: 1,
          ip: '192.168.0.10',
          port: 8080,
          token: 'secret',
          deviceId: 'bridge-123',
          deviceName: 'Bridge Casa',
        },
      ],
    });

    const { result } = renderHook(() => useBridgeConfig());

    expect(result.current.config).toEqual({
      id: 1,
      ip: '192.168.0.10',
      port: 8080,
      token: 'secret',
      deviceId: 'bridge-123',
      deviceName: 'Bridge Casa',
    });
    expect(result.current.isConfigured).toBe(true);
  });

  it('retorna isConfigured=false cuando no hay deviceId', () => {
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({
      data: [
        {
          id: 1,
          ip: '192.168.0.10',
          port: 8080,
          token: 'secret',
          deviceId: null,
          deviceName: 'Bridge Casa',
        },
      ],
    });

    const { result } = renderHook(() => useBridgeConfig());

    expect(result.current.isConfigured).toBe(false);
  });

  it('unpair() exitoso llama clearBridgeConfig', async () => {
    (clearBridgeConfig as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useBridgeConfig());

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;

    await act(async () => {
      response = await result.current.unpair();
    });

    expect(clearBridgeConfig).toHaveBeenCalledWith(rawDb);
    expect(response).toEqual({ success: true });
    expect(result.current.isUnpairing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('unpair() fallido expone error', async () => {
    (clearBridgeConfig as jest.Mock).mockRejectedValue(new Error('No se pudo limpiar'));

    const { result } = renderHook(() => useBridgeConfig());

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;

    await act(async () => {
      response = await result.current.unpair();
    });

    expect(response).toEqual({ success: false, error: 'No se pudo limpiar' });
    expect(result.current.error).toBe('No se pudo limpiar');
    expect(result.current.isUnpairing).toBe(false);
  });
});
