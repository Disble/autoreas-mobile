import { renderHook, act } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as initialSync from '../../../src/features/sync/use-initial-sync';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

// AppState listeners registry — shared between mock and tests
const appStateListeners: ((state: string) => void)[] = [];

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-initial-sync', () => ({
  upsertAnimeFromBridge: jest.fn(),
  deleteAnimeLocally: jest.fn(),
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((event: string, cb: (state: string) => void) => {
      appStateListeners.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = appStateListeners.indexOf(cb);
          if (idx !== -1) appStateListeners.splice(idx, 1);
        }),
      };
    }),
  },
}));

const { useSQLiteContext } = jest.requireMock('expo-sqlite') as { useSQLiteContext: jest.Mock };

const mockConfig = { ip: '192.168.1.10', port: 8080, token: 'token123' };
const rawDb = { name: 'raw-db' };

function emitAppState(state: string) {
  appStateListeners.forEach((l) => { l(state); });
}

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
  let mockWs: ReturnType<typeof buildWsMock>;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateListeners.length = 0;
    mockWs = buildWsMock();
    useSQLiteContext.mockReturnValue(rawDb);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(mockConfig);

    global.WebSocket = jest.fn().mockImplementation(() => {
      mockWs.readyState = WebSocket.CONNECTING;
      return mockWs;
    }) as unknown as typeof WebSocket;
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CONNECTING = 0;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('connects to WebSocket on mount when AppState is active', async () => {
    renderHook(() => useWebSocket());

    await act(async () => { await Promise.resolve(); });

    expect(global.WebSocket).toHaveBeenCalledWith(
      'ws://192.168.1.10:8080/ws',
      null,
      expect.objectContaining({ headers: { Authorization: 'Bearer token123' } })
    );
  });

  it('disconnects when AppState changes to background', async () => {
    renderHook(() => useWebSocket());

    await act(async () => { await Promise.resolve(); });

    act(() => { emitAppState('background'); });

    expect(mockWs.close).toHaveBeenCalled();
  });

  it('calls onSyncRequired when receiving sync_required event', async () => {
    const onSyncRequired = jest.fn();

    renderHook(() => useWebSocket({ onSyncRequired }));
    await act(async () => { await Promise.resolve(); });

    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({ data: JSON.stringify({ type: 'sync_required' }) } as MessageEvent);
      await Promise.resolve();
    });

    expect(onSyncRequired).toHaveBeenCalledTimes(1);
  });

  it('calls upsertAnimeFromBridge when anime_changed arrives', async () => {
    (initialSync.upsertAnimeFromBridge as jest.Mock).mockResolvedValue(undefined);

    renderHook(() => useWebSocket());
    await act(async () => { await Promise.resolve(); });
    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_changed', anime_id: 'anime-1' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(initialSync.upsertAnimeFromBridge).toHaveBeenCalledWith(rawDb, 'anime-1');
  });

  it('calls upsertAnimeFromBridge when anime_created arrives', async () => {
    (initialSync.upsertAnimeFromBridge as jest.Mock).mockResolvedValue(undefined);

    renderHook(() => useWebSocket());
    await act(async () => { await Promise.resolve(); });
    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_created', anime_id: 'anime-2' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(initialSync.upsertAnimeFromBridge).toHaveBeenCalledWith(rawDb, 'anime-2');
  });

  it('calls deleteAnimeLocally when anime_deleted arrives', async () => {
    (initialSync.deleteAnimeLocally as jest.Mock).mockResolvedValue(undefined);

    renderHook(() => useWebSocket());
    await act(async () => { await Promise.resolve(); });
    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({ type: 'anime_deleted', anime_id: 'anime-3' }),
      } as MessageEvent);
      await Promise.resolve();
    });

    expect(initialSync.deleteAnimeLocally).toHaveBeenCalledWith(rawDb, 'anime-3');
  });
});
