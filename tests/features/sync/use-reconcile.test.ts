import { syncPendingOperations } from '../../../src/features/sync/use-reconcile';
import * as dbClient from '../../../src/infrastructure/db/client';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: jest.fn(),
  openDatabaseSync: jest.fn(),
}));

// Mock everything from client
jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
  getBridgeConfigSnapshot: jest.fn(),
  withExclusiveWrite: jest.fn(),
}));

describe('syncPendingOperations', () => {
  let rawDb: any;
  let mockDb: any;
  let mockUpdateSet: any;
  let mockUpdateWhere: any;

  beforeEach(() => {
    rawDb = {}; // Fake sqlite connection
    
    // Mock the query builder for update
    mockUpdateWhere = jest.fn();
    mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });
    
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn(),
      update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
    };

    (dbClient.createDrizzleDb as jest.Mock).mockReturnValue(mockDb);
    
    (dbClient.withExclusiveWrite as jest.Mock).mockImplementation(async (db, task) => {
      return task(mockDb, db); // Simulate transaction success and run the task
    });

    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('No hace nada si falta la configuracion', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);

    await expect(syncPendingOperations(rawDb)).rejects.toThrow('Bridge config is missing or incomplete');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('No hace requests si no hay pending operations', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123'
    });
    mockDb.where.mockResolvedValue([]); // pendingOps = []

    const result = await syncPendingOperations(rawDb);
    expect(result).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Si hay error de red o fetch falla, mantiene logs en pending y no llama a withExclusiveWrite', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123'
    });
    
    mockDb.where.mockResolvedValue([
      { id: 1, animeId: 'anime1', payload: JSON.stringify({ nrocapvisto: 5 }), status: 'pending' },
      { id: 2, animeId: 'anime2', payload: JSON.stringify({ estado: 1 }), status: 'pending' },
    ]);

    // First fetch fails, second fetch returns 500
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network Error'))
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const syncedCount = await syncPendingOperations(rawDb);

    expect(syncedCount).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
  });

  it('Conexion exitosa -> marca los logs como synced', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123'
    });
    
    mockDb.where.mockResolvedValue([
      { id: 1, animeId: 'anime1', payload: JSON.stringify({ nrocapvisto: 5 }), status: 'pending' }
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    const syncedCount = await syncPendingOperations(rawDb);

    expect(syncedCount).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/animes/anime1',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token123',
        },
        body: JSON.stringify({ nrocapvisto: 5 })
      })
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'synced' });
  });
});
