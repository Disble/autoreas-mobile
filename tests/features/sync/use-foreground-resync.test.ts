import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as cycleHelpers from '../../../src/features/sync/foreground-resync-cycle.helpers';
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

jest.mock('../../../src/features/sync/foreground-resync-cycle.helpers', () => ({
  runForegroundResyncCycle: jest.fn(),
}));

/** Fires every collected `AppState` change listener with `status`, simulating a foreground/background transition. */
function emitAppState(status: string) {
  appStateListeners.forEach((listener) => listener(status));
}

describe('useForegroundResync', () => {
  const mockRunCycle = cycleHelpers.runForegroundResyncCycle as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    AppState.currentState = 'active';
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    mockRunCycle.mockResolvedValue(undefined);
  });

  it('runs one cycle on mount', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRunCycle).toHaveBeenCalledWith({ id: 'raw-db' });
    expect(mockRunCycle).toHaveBeenCalledTimes(1);
  });

  it('runs another cycle when the app returns to the foreground', async () => {
    AppState.currentState = 'background';

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockRunCycle.mockClear();

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockRunCycle).toHaveBeenCalledWith({ id: 'raw-db' });
  });

  it('does not run a cycle on a non-active transition', async () => {
    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockRunCycle.mockClear();

    await act(async () => {
      emitAppState('inactive');
      await Promise.resolve();
    });

    expect(mockRunCycle).not.toHaveBeenCalled();
  });

  it('calls the cycle helper even without an SQLite context yet (the helper itself no-ops on null)', async () => {
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRunCycle).toHaveBeenCalledWith(null);
  });

  it('does NOT run another cycle on a rerender with the same rawDb (protects against an uncompiled-in-Jest effect re-run)', async () => {
    const { rerender } = renderHook(() => useForegroundResync());

    await act(async () => {
      await Promise.resolve();
    });

    mockRunCycle.mockClear();

    rerender({});

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRunCycle).not.toHaveBeenCalled();
  });
});
