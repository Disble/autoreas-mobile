import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

// AppState listeners registry — shared between mock and tests
const appStateListeners: Array<(state: string) => void> = [];

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
  createDrizzleDb: jest.fn(),
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

  it('Optimistic Ignorance: drops anime_changed if pending operation exists for that anime', async () => {
    const mockUpdateWhere = jest.fn();
    const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
    const mockDbForWs = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      // count returns 1 → pending exists
      where: jest.fn().mockResolvedValue([{ count: 1 }]),
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    };

    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_rawDb: unknown, task: (db: typeof mockDbForWs, raw: unknown) => Promise<unknown>) =>
      task(mockDbForWs, _rawDb)
    );

    renderHook(() => useWebSocket());
    await act(async () => { await Promise.resolve(); });
    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'anime_changed',
          anime_id: 'anime-1',
          payload: { nrocapvisto: 4 },
        }),
      } as MessageEvent);
      await Promise.resolve();
    });

    // select was called to check count
    expect(mockDbForWs.select).toHaveBeenCalled();
    // update NOT called — event dropped
    expect(mockDbForWs.update).not.toHaveBeenCalled();
  });

  it('updates anime when anime_changed arrives and NO pending operation exists', async () => {
    const mockUpdateWhere = jest.fn().mockResolvedValue(undefined);
    const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
    const mockDbForWs = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      // count returns 0 → no pending
      where: jest.fn().mockResolvedValue([{ count: 0 }]),
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    };

    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (_rawDb: unknown, task: (db: typeof mockDbForWs, raw: unknown) => Promise<unknown>) =>
      task(mockDbForWs, _rawDb)
    );

    renderHook(() => useWebSocket());
    await act(async () => { await Promise.resolve(); });
    act(() => { mockWs.onopen?.({} as Event); });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'anime_changed',
          anime_id: 'anime-1',
          payload: { nrocapvisto: 4 },
        }),
      } as MessageEvent);
      await Promise.resolve();
    });

    // select was called to check count
    expect(mockDbForWs.select).toHaveBeenCalled();
    // update WAS called — anime patched
    expect(mockDbForWs.update).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith({ nrocapvisto: 4 });
  });
});
