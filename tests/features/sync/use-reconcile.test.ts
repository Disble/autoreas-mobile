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

  it('Siempre hace POST a /api/sync/reconcile aunque no haya pending operations', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });
    mockDb.where.mockResolvedValue([]); // pendingOps = []

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    const result = await syncPendingOperations(rawDb);
    expect(result).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token123' }),
      })
    );
  });

  it('Si hay error de red, lanza error y no llama a withExclusiveWrite', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });

    mockDb.where.mockResolvedValue([
      { id: 1, animeId: 'anime1', operation: 'update', payload: JSON.stringify({ nrocapvisto: 5 }), status: 'pending', createdAt: Date.now() },
    ]);

    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network Error'));

    await expect(syncPendingOperations(rawDb)).rejects.toThrow('Network Error');
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
  });

  it('Si el bridge responde con error HTTP, lanza error y no llama a withExclusiveWrite', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
    });

    mockDb.where.mockResolvedValue([
      { id: 1, animeId: 'anime1', operation: 'update', payload: JSON.stringify({ nrocapvisto: 5 }), status: 'pending', createdAt: Date.now() },
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await expect(syncPendingOperations(rawDb)).rejects.toThrow('Reconcile failed: 500');
    expect(dbClient.withExclusiveWrite).not.toHaveBeenCalled();
  });

  it('Conexion exitosa -> aplica bridge_changes y marca los logs como synced', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '192.168.1.10',
      port: 8080,
      token: 'token123',
      deviceId: 'device-abc',
    });

    mockDb.where.mockResolvedValue([
      { id: 1, animeId: 'anime1', operation: 'update', payload: JSON.stringify({ nrocapvisto: 5 }), status: 'pending', createdAt: Date.now() },
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', bridge_changes: [], conflicts: [] }),
    });

    const syncedCount = await syncPendingOperations(rawDb);

    expect(syncedCount).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/sync/reconcile',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123',
        },
      })
    );
    expect(dbClient.withExclusiveWrite).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: 'synced' });
  });
});
