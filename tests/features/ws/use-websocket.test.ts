import { act, renderHook } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime';
import * as initialSync from '../../../src/features/sync/use-initial-sync';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-initial-sync', () => ({
  upsertAnimeFromBridge: jest.fn(),
  deleteAnimeLocally: jest.fn(),
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

  it('keeps bridge snapshot updates working while enabled', async () => {
    (initialSync.upsertAnimeFromBridge as jest.Mock).mockResolvedValue(undefined);

    renderHook(() => useWebSocket({ enabled: true }));

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

    expect(initialSync.upsertAnimeFromBridge).toHaveBeenCalledWith(rawDb, 'anime-1');
  });
});
