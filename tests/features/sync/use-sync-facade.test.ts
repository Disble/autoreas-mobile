import { act, renderHook } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime';
import * as settingsModule from '../../../src/features/settings/use-bridge-config';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as initialSyncModule from '../../../src/features/sync/use-initial-sync';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-initial-sync', () => ({
  initialSync: jest.fn(),
}));

jest.mock('../../../src/features/ws/use-websocket', () => ({
  useWebSocket: jest.fn(),
}));

describe('useSyncFacade', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: 'device-1' },
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    (dbClient.createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    (useWebSocket as jest.Mock).mockImplementation(() => ({}));
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValue(3);
    (initialSyncModule.initialSync as jest.Mock).mockResolvedValue(10);
    (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockImplementation(
      (_query: unknown, fallbackData: unknown) => ({ data: fallbackData }),
    );
  });

  it('usa reconcile como estrategia de bootstrap cuando ya existe cache local', async () => {
    (nativeRuntime.useOptionalLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [{ _id: 'anime-1' }] })
      .mockReturnValueOnce({ data: [{ id: 1 }, { id: 2 }] });

    renderHook(() => useSyncFacade());

    await act(async () => {
      await Promise.resolve();
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
    expect(initialSyncModule.initialSync).not.toHaveBeenCalled();
  });

  it('usa hidratación inicial como estrategia de bootstrap cuando no hay cache local', async () => {
    (nativeRuntime.useOptionalLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [] })
      .mockReturnValueOnce({ data: [] });

    renderHook(() => useSyncFacade());

    await act(async () => {
      await Promise.resolve();
    });

    expect(initialSyncModule.initialSync).toHaveBeenCalledWith(rawDb);
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
  });

  it('expone manualSync como fachada simple sobre el subsistema de sync', async () => {
    (nativeRuntime.useOptionalLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [{ _id: 'anime-1' }] })
      .mockReturnValueOnce({ data: [{ id: 1 }] });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await Promise.resolve();
    });

    (syncModule.syncPendingOperations as jest.Mock).mockClear();

    await act(async () => {
      await result.current.manualSync();
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
  });

  it('adapta el callback async de sync al contrato void del websocket', async () => {
    (nativeRuntime.useOptionalLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [{ _id: 'anime-1' }] })
      .mockReturnValueOnce({ data: [] });

    renderHook(() => useSyncFacade());

    await act(async () => {
      await Promise.resolve();
    });

    const webSocketProps = (useWebSocket as jest.Mock).mock.calls[0]?.[0];
    (syncModule.syncPendingOperations as jest.Mock).mockClear();

    await act(async () => {
      webSocketProps.onSyncRequired();
      await Promise.resolve();
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
  });
});
