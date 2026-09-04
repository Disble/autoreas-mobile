import { act, renderHook } from '@testing-library/react-native';
import { useSyncTelemetryPreference } from '../../../src/features/settings/use-sync-telemetry-preference';
import {
  createDrizzleDb,
  withLocalWrite,
} from '../../../src/infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
  withLocalWrite: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

describe('useSyncTelemetryPreference', () => {
  const rawDb = { id: 'raw-db' };
  let setValues: Record<string, unknown> | null;

  function mockConfigRow(row: Record<string, unknown> | null) {
    (useOptionalLiveQuery as jest.Mock).mockReturnValue({ data: row ? [row] : [] });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setValues = null;

    const queryBuilder = {
      from: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue({ query: 'bridge-config' }),
    };

    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue(queryBuilder),
    });
    (withLocalWrite as jest.Mock).mockImplementation(
      async (_db: unknown, run: (writeDb: unknown) => Promise<void>) => {
        await run({
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
              setValues = values;
              return { where: jest.fn().mockResolvedValue(undefined) };
            }),
          }),
        });
      },
    );
    mockConfigRow(null);
  });

  it('reporta habilitado cuando todavía no hay preferencia persistida', () => {
    const { result } = renderHook(() => useSyncTelemetryPreference());

    expect(result.current.isEnabled).toBe(true);
  });

  it('reporta deshabilitado cuando el usuario lo apagó', () => {
    mockConfigRow({ id: 1, isSyncTelemetryEnabled: false });

    const { result } = renderHook(() => useSyncTelemetryPreference());

    expect(result.current.isEnabled).toBe(false);
  });

  it('persiste la elección del usuario en una sola columna', async () => {
    mockConfigRow({ id: 1, isSyncTelemetryEnabled: true });

    const { result } = renderHook(() => useSyncTelemetryPreference());

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(withLocalWrite).toHaveBeenCalledTimes(1);
    expect(setValues).toEqual({ isSyncTelemetryEnabled: false });
  });

  it('no intenta escribir cuando no hay base de datos disponible', async () => {
    // El apagado tiene que degradar en silencio, nunca reventar la pantalla de Settings.
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useSyncTelemetryPreference());

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(withLocalWrite).not.toHaveBeenCalled();
  });

  it('no intenta escribir cuando todavía no existe una fila de config', async () => {
    // Sin fila emparejada no hay nada que actualizar: un UPDATE sin destino no crea la
    // preferencia y dejaría al switch mintiendo sobre lo que persistió.
    mockConfigRow(null);

    const { result } = renderHook(() => useSyncTelemetryPreference());

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(withLocalWrite).not.toHaveBeenCalled();
  });
});
