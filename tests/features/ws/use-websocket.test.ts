import { act, renderHook } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

function buildWsMock() {
  return {
    onopen: null as ((e: Event) => void) | null,
    onmessage: null as ((e: MessageEvent) => void) | null,
    onclose: null as ((e: CloseEvent) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    close: jest.fn(),
    readyState: WebSocket.CONNECTING as number,
  };
}

describe('useWebSocket', () => {
  const rawDb = { name: 'raw-db' };
  const mockConfig = { ip: '192.168.1.10', port: 8080, token: 'token123' };
  let mockWs: ReturnType<typeof buildWsMock>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockWs = buildWsMock();

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(mockConfig);

    global.WebSocket = jest.fn().mockImplementation(() => {
      mockWs.readyState = WebSocket.CONNECTING;
      return mockWs;
    }) as unknown as typeof WebSocket;
    (global.WebSocket as typeof WebSocket & { OPEN: number; CONNECTING: number }).OPEN = 1;
    (global.WebSocket as typeof WebSocket & { OPEN: number; CONNECTING: number }).CONNECTING = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not connect while the root runtime keeps websocket disabled', async () => {
    renderHook(() => useWebSocket({ enabled: false }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('connects when the root runtime enables foreground websocket ownership', async () => {
    renderHook(() => useWebSocket({ enabled: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.WebSocket).toHaveBeenCalledWith(
      'ws://192.168.1.10:8080/ws',
      null,
      expect.objectContaining({ headers: { Authorization: 'Bearer token123' } }),
    );
  });

  it('disconnects when the runtime disables websocket ownership', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWebSocket({ enabled }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ enabled: false });

    expect(mockWs.close).toHaveBeenCalledTimes(1);
  });

  it('routes sync_required to the runtime callback without screen coupling', async () => {
    const onSyncRequired = jest.fn();

    renderHook(() => useWebSocket({ enabled: true, onSyncRequired }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'sync_required' }) } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
  });

  it('ignores an unrecognized message type without throwing or invoking callbacks', async () => {
    const onSyncRequired = jest.fn();
    const onPreferencesChanged = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    renderHook(() =>
      useWebSocket({ enabled: true, onSyncRequired, onPreferencesChanged }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'some_future_message', foo: 1 }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).not.toHaveBeenCalled();
    expect(onPreferencesChanged).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('routes preferences_changed to the preferences callback, not the reconcile callback', async () => {
    const onSyncRequired = jest.fn();
    const onPreferencesChanged = jest.fn();

    renderHook(() =>
      useWebSocket({ enabled: true, onSyncRequired, onPreferencesChanged }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'preferences_changed', season_mode: true }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(onPreferencesChanged).toHaveBeenCalledWith(true);
    expect(onSyncRequired).not.toHaveBeenCalled();
  });

  it('routes anime_changed through the reconcile callback instead of clobbering the row directly', async () => {
    const onSyncRequired = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch');

    renderHook(() => useWebSocket({ enabled: true, onSyncRequired }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_changed', anime_id: 'anime-1' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes anime_created through the reconcile callback instead of clobbering the row directly', async () => {
    const onSyncRequired = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch');

    renderHook(() => useWebSocket({ enabled: true, onSyncRequired }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_created', anime_id: 'anime-2' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes anime_deleted through the reconcile callback instead of a direct local delete', async () => {
    const onSyncRequired = jest.fn();

    renderHook(() => useWebSocket({ enabled: true, onSyncRequired }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      mockWs.onopen?.({} as Event);
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_deleted', anime_id: 'anime-3' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
  });
});
