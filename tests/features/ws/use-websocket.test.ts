import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useWebSocket } from '../../../src/features/ws/use-websocket';
import { openAppDatabaseSync, runMigrations, createDrizzleDb, insertDummyAnime, withExclusiveWrite } from '../../../src/infrastructure/db/client';
import { animes, bridgeConfig, operationLog } from '../../../src/infrastructure/db/schema';
import { useSQLiteContext } from 'expo-sqlite';
import { eq } from 'drizzle-orm';

// Mock expo-sqlite
jest.mock('expo-sqlite', () => {
  const actual = jest.requireActual('expo-sqlite');
  return {
    ...actual,
    useSQLiteContext: jest.fn(),
  };
});

// Mock AppState is not needed via jest.mock('react-native'). We will spy on it.

describe('useWebSocket', () => {
  let rawDb: ReturnType<typeof openAppDatabaseSync>;
  let db: ReturnType<typeof createDrizzleDb>;
  let mockWebSocket: any;
  let appStateListener: (state: any) => void;

  beforeAll(async () => {
    rawDb = openAppDatabaseSync();
    db = await runMigrations(rawDb);
  });

  beforeEach(async () => {
    (useSQLiteContext as jest.Mock).mockReturnValue(rawDb);

    await withExclusiveWrite(rawDb, async (txDb: any) => {
      await txDb.delete(animes);
      await txDb.delete(operationLog);
      await txDb.delete(bridgeConfig);
      await txDb.insert(bridgeConfig).values({
        id: 1,
        ip: '192.168.1.100',
        port: 8080,
        token: 'test-token',
      });
    });

    // Mock global WebSocket
    mockWebSocket = {
      close: jest.fn(),
      readyState: 1,
      send: jest.fn(),
    };
    (global as any).WebSocket = jest.fn().mockImplementation(() => mockWebSocket);

    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('active');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
      if (event === 'change') {
        appStateListener = callback;
      }
      return { remove: jest.fn() } as any;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('connects to WebSocket on mount if AppState is active', async () => {
    renderHook(() => useWebSocket());
    
    // allow microtasks for async connect
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(global.WebSocket).toHaveBeenCalledWith('ws://192.168.1.100:8080/ws', null, {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('disconnects when AppState changes to background', async () => {
    renderHook(() => useWebSocket());
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    act(() => {
      appStateListener('background');
    });

    expect(mockWebSocket.close).toHaveBeenCalled();
  });

  it('calls onSyncRequired when receiving sync_required event', async () => {
    const onSyncRequired = jest.fn();
    renderHook(() => useWebSocket({ onSyncRequired }));
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Simulate incoming message
    await act(async () => {
      await mockWebSocket.onmessage({ data: JSON.stringify({ type: 'sync_required' }) });
    });

    expect(onSyncRequired).toHaveBeenCalled();
  });

  it('Optimistic Ignorance: drops anime_changed event if pending operation exists', async () => {
    renderHook(() => useWebSocket());
    
    // Insert dummy anime
    const dummy = await insertDummyAnime(rawDb);

    // Insert pending operation
    await withExclusiveWrite(rawDb, async (txDb: any) => {
      await txDb.insert(operationLog).values({
        animeId: dummy._id,
        operation: 'cap_plus',
        payload: '{}',
        status: 'pending',
        createdAt: Date.now(),
      });
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Simulate incoming message with nrocapvisto: 4
    await act(async () => {
      await mockWebSocket.onmessage({
        data: JSON.stringify({
          type: 'anime_changed',
          anime_id: dummy._id,
          payload: { nrocapvisto: 4 },
        }),
      });
    });

    // Verify anime was NOT updated
    const result = await db.select().from(animes).where(eq(animes._id, dummy._id));
    expect(result[0].nrocapvisto).toBe(0); // remains 0
  });

  it('updates anime when anime_changed event arrives and NO pending operation exists', async () => {
    renderHook(() => useWebSocket());
    
    // Insert dummy anime
    const dummy = await insertDummyAnime(rawDb);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Simulate incoming message with nrocapvisto: 4
    await act(async () => {
      await mockWebSocket.onmessage({
        data: JSON.stringify({
          type: 'anime_changed',
          anime_id: dummy._id,
          payload: { nrocapvisto: 4 },
        }),
      });
    });

    // Verify anime WAS updated
    const result = await db.select().from(animes).where(eq(animes._id, dummy._id));
    expect(result[0].nrocapvisto).toBe(4);
  });
});
