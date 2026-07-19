import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as resyncHelpers from '../../../src/features/sync/full-resync.helpers';
import { useForegroundResync } from '../../../src/features/sync/use-foreground-resync';

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

jest.mock('../../../src/features/sync/full-resync.helpers', () => ({
  resyncFromBridgeSnapshot: jest.fn(),
}));

function emitAppState(status: string) {
  appStateListeners.forEach((listener) => listener(status));
}

describe('useForegroundResync', () => {
  const mockResync = resyncHelpers.resyncFromBridgeSnapshot as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    AppState.currentState = 'active';
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    mockResync.mockResolvedValue({ healed: 0 });
  });

  it('resyncs on mount', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockResync).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(mockResync).toHaveBeenCalledTimes(1);
  });

  it('resyncs again when the app returns to the foreground', async () => {
    AppState.currentState = 'background';

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockResync.mockClear();

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockResync).toHaveBeenCalledWith({ id: 'raw-db' });
  });

  it('does not resync on a non-active transition', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockResync.mockClear();

    await act(async () => {
      emitAppState('inactive');
      await Promise.resolve();
    });

    expect(mockResync).not.toHaveBeenCalled();
  });

  it('does nothing when there is no SQLite context yet', async () => {
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockResync).not.toHaveBeenCalled();
  });

  it('swallows resync failures so a transient error never surfaces as an unhandled rejection', async () => {
    mockResync.mockRejectedValue(new Error('boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useForegroundResync] Resync failed',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
