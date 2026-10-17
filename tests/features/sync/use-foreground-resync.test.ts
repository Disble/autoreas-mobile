import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as coverSweep from '../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import { useForegroundResync } from '../../../src/features/sync/use-foreground-resync';

/** Listeners the mocked `AppState.addEventListener` collected, so a test can drive them directly. */
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

jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  hydrateCoverUris: jest.fn(),
}));

/** Fires every collected `AppState` change listener with `status`, simulating a foreground/background transition. */
function emitAppState(status: string) {
  appStateListeners.forEach((listener) => listener(status));
}

describe('useForegroundResync', () => {
  const mockHydrate = coverSweep.hydrateCoverUris as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    AppState.currentState = 'active';
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    mockHydrate.mockResolvedValue(undefined);
  });

  it('starts one cover hydration on mount', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHydrate).toHaveBeenCalledWith();
    expect(mockHydrate).toHaveBeenCalledTimes(1);
  });

  it('starts another cover hydration when the app returns to the foreground', async () => {
    AppState.currentState = 'background';

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockHydrate.mockClear();

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockHydrate).toHaveBeenCalledWith();
  });

  it('does not hydrate on a non-active transition', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockHydrate.mockClear();

    await act(async () => {
      emitAppState('inactive');
      await Promise.resolve();
    });

    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it('does nothing without an SQLite context yet, on mount or on resume', async () => {
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);
    AppState.currentState = 'background';

    renderHook(() => useForegroundResync());

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it('does NOT hydrate again on a rerender with the same rawDb (protects against an uncompiled-in-Jest effect re-run)', async () => {
    const { rerender } = renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockHydrate.mockClear();

    rerender({});

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHydrate).not.toHaveBeenCalled();
  });
});
