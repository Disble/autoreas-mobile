import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as drainHelpers from '../../../src/features/sync/remote-change-drain.helpers';
import { useRemoteChangeDrain } from '../../../src/features/sync/use-remote-change-drain';

const appStateListeners: ((status: string) => void)[] = [];

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_: string, listener: (status: string) => void) => {
      appStateListeners.push(listener);

      return {
        remove: jest.fn(() => {
          const index = appStateListeners.indexOf(listener);
          if (index >= 0) {
            appStateListeners.splice(index, 1);
          }
        }),
      };
    }),
  },
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/sync/remote-change-drain.helpers', () => ({
  drainPendingRemoteChanges: jest.fn(),
}));

function emitAppState(status: string) {
  appStateListeners.forEach((listener) => listener(status));
}

describe('useRemoteChangeDrain', () => {
  const mockDrain = drainHelpers.drainPendingRemoteChanges as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    AppState.currentState = 'active';
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    mockDrain.mockResolvedValue({ applied: 0, dropped: 0, deferred: 0, drainedCount: 0 });
  });

  it('drains staged remote changes on mount', async () => {
    renderHook(() => useRemoteChangeDrain());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDrain).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('drains again when the app returns to the foreground', async () => {
    AppState.currentState = 'background';

    renderHook(() => useRemoteChangeDrain());

    await act(async () => {
      await Promise.resolve();
    });

    mockDrain.mockClear();

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockDrain).toHaveBeenCalledWith({ id: 'raw-db' });
  });

  it('does not drain again on a background-to-background or active-to-inactive transition', async () => {
    renderHook(() => useRemoteChangeDrain());

    await act(async () => {
      await Promise.resolve();
    });

    mockDrain.mockClear();

    await act(async () => {
      emitAppState('inactive');
      await Promise.resolve();
    });

    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('does nothing when there is no SQLite context available yet', async () => {
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    renderHook(() => useRemoteChangeDrain());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('swallows drain failures so a transient error never surfaces as an unhandled rejection', async () => {
    mockDrain.mockRejectedValue(new Error('boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useRemoteChangeDrain());

    await act(async () => {
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useRemoteChangeDrain] Drain failed',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
