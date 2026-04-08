import { renderHook, act } from '@testing-library/react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { usePairDevice } from '../../../src/features/setup/use-pair-device';
import { withExclusiveWrite } from '../../../src/infrastructure/db/client';

// Mocks MUST be hoisted, NO dynamic imports
jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  withExclusiveWrite: jest.fn(),
}));

describe('usePairDevice', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    (useSQLiteContext as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('R3: should return success and save config on 200/201 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_id: 'dev-123',
        device_name: 'My Bridge',
        auth_token: 'auth-secret',
      }),
    });

    (withExclusiveWrite as jest.Mock).mockImplementation(async (db, cb) => {
      const mockTxDb = {
        delete: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockResolvedValue(true),
      };
      await cb(mockTxDb);
    });

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

    expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.10:8080/api/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairing_token: 'pairing123', device_name: 'AutoreasMobile' }),
    });

    expect(withExclusiveWrite).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('R4: should return error and NOT save config on 400 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    const { result } = renderHook(() => usePairDevice());

    let pairResult: { success: boolean; data?: any; error?: string } | undefined = undefined;
    await act(async () => {
      pairResult = await result.current.pair({ ip: '192.168.1.10', port: '8080', token: 'invalid' });
    });

    expect(pairResult).toEqual({
      success: false,
      error: 'Failed to pair: 400',
    });

    expect(withExclusiveWrite).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Failed to pair: 400');
  });

  it('should return error if device_id or auth_token is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_name: 'Missing fields',
      }),
    });

    const { result } = renderHook(() => usePairDevice());

    let pairResult: { success: boolean; data?: any; error?: string } | undefined = undefined;
    await act(async () => {
      pairResult = await result.current.pair({ ip: '1.1.1.1', port: 80, token: 'xxx' });
    });

    expect(pairResult).toEqual({
      success: false,
      error: 'Invalid response from bridge',
    });

    expect(withExclusiveWrite).not.toHaveBeenCalled();
  });
});
