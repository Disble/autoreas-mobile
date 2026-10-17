import { renderHook } from '@testing-library/react-native';
import { useBackgroundSyncStatus } from '../../../src/features/settings/use-background-sync-status';
import { createDrizzleDb } from '../../../src/infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useBackgroundSyncStatus', () => {
  const rawDb = { id: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    const queryBuilder = {
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue({ query: 'sync-runtime-status' }),
    };

    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue(queryBuilder),
    });
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({ data: [] });
  });

  it('retorna snapshot vacío cuando no existe fila persistida', () => {
    const { result } = renderHook(() => useBackgroundSyncStatus());

    expect(result.current.snapshot).toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'best_effort_background_task',
      canShowPersistentNotification: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastCycleId: null,
      lastCycleStage: null,
      lastErrorName: null,
    });
  });

  it('retorna snapshot observable de éxito persistido', () => {
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({
      data: [
        {
          id: 1,
          registrationStatus: 'registered',
          executionMode: 'best_effort_background_task',
          canShowPersistentNotification: false,
          lastAttemptAt: 1710000000000,
          lastSuccessAt: 1710000005000,
          lastCycleId: 'cycle-native-1',
          lastCycleStage: 'closed',
          lastErrorName: null,
        },
      ],
    });

    const { result } = renderHook(() => useBackgroundSyncStatus());

    expect(result.current.snapshot).toEqual({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      canShowPersistentNotification: false,
      lastAttemptAt: 1710000000000,
      lastSuccessAt: 1710000005000,
      lastCycleId: 'cycle-native-1',
      lastCycleStage: 'closed',
      lastErrorName: null,
    });
  });

  it('retorna snapshot observable de fallo persistido', () => {
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({
      data: [
        {
          id: 1,
          registrationStatus: 'registered',
          executionMode: 'best_effort_background_task',
          canShowPersistentNotification: false,
          lastAttemptAt: 1710000000000,
          lastSuccessAt: null,
          lastCycleId: 'cycle-native-2',
          lastCycleStage: 'sent',
          lastErrorName: 'ReconcileHttpError',
        },
      ],
    });

    const { result } = renderHook(() => useBackgroundSyncStatus());

    expect(result.current.snapshot).toEqual({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      canShowPersistentNotification: false,
      lastAttemptAt: 1710000000000,
      lastSuccessAt: null,
      lastCycleId: 'cycle-native-2',
      lastCycleStage: 'sent',
      lastErrorName: 'ReconcileHttpError',
    });
  });
});
