import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useStartup } from '../../../../src/features/startup/use-startup';
import { navigateAndReleaseStartupSplash } from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.helpers';
import { useStartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/use-startup-boundary';

jest.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
  useFonts: jest.fn(() => [true]),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-splash-screen', () => ({
  hide: jest.fn(),
  hideAsync: jest.fn(async () => undefined),
  preventAutoHideAsync: jest.fn(async () => undefined),
  setOptions: jest.fn(),
}));

jest.mock('../../../../src/features/startup/use-startup', () => ({
  useStartup: jest.fn(),
}));

describe('useStartupBoundary splash lifecycle', () => {
  const replace = jest.fn();
  const mockSQLiteProvider = 'SQLiteProvider';

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockReset();
    jest.useRealTimers();
    (useFonts as jest.Mock).mockReturnValue([true]);
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'preparing_database',
        target: null,
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: false,
    });
  });

  it('releases splash once and rethrows the exact navigation exception', () => {
    const navigationError = new Error('navigation failed');
    const failingRouter = {
      replace: jest.fn(() => {
        throw navigationError;
      }),
    };

    let caughtError: unknown;
    try {
      navigateAndReleaseStartupSplash(failingRouter, '/setup');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBe(navigationError);
    expect(failingRouter.replace).toHaveBeenCalledWith('/setup');
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('hides the splash screen and skips navigation when bootstrap fails', async () => {
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: {
          diagnostic: {
            stage: 'database_preparation',
            code: 'SQLITE_ERROR',
            classification: 'sqlite',
          },
          diagnosticMessage: 'Error al preparar la base local durante el inicio.',
          recoveryHint:
            'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
        },
        phase: 'fatal',
        target: null,
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: false,
    });

    renderHook(() => useStartupBoundary({}));

    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the controlled fallback and releases splash when fonts do not settle before the deadline', async () => {
    jest.useFakeTimers();
    (useFonts as jest.Mock).mockReturnValue([false]);
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    const { result } = renderHook(() => useStartupBoundary({}));

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.screen).toBe('startup-failure');
    expect(result.current.preProviderContent).not.toBeNull();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the controlled fallback and releases splash when font loading fails', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('asset unavailable')]);
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    const { result } = renderHook(() => useStartupBoundary({}));

    await waitFor(() => {
      expect(result.current.screen).toBe('startup-failure');
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the successful route after the font deadline window when fonts are loaded', async () => {
    jest.useFakeTimers();
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    const { result } = renderHook(() => useStartupBoundary({}));

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.screen).toBe('route-slot');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the success navigation flow unchanged when bootstrap finishes', async () => {
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    renderHook(() => useStartupBoundary({}));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/setup');
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('releases splash once when ready-state navigation throws synchronously', () => {
    replace.mockImplementation(() => {
      throw new Error('navigation failed');
    });
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    expect(() => renderHook(() => useStartupBoundary({}))).toThrow('navigation failed');

    expect(replace).toHaveBeenCalledTimes(1);
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to hide once without an unhandled rejection when failure-state hideAsync rejects', async () => {
    (SplashScreen.hideAsync as jest.Mock).mockRejectedValue(new Error('native release failed'));
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: {
          diagnostic: {
            stage: 'database_preparation',
            code: null,
            classification: 'unknown',
          },
          diagnosticMessage: 'Startup failed.',
          recoveryHint: 'Restart the app.',
        },
        phase: 'fatal',
        target: null,
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: false,
    });

    renderHook(() => useStartupBoundary({}));

    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
      expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to hide once without an unhandled rejection when ready-state hideAsync rejects', async () => {
    (SplashScreen.hideAsync as jest.Mock).mockRejectedValue(new Error('native release failed'));
    (useStartup as jest.Mock).mockReturnValue({
      startupState: {
        failure: null,
        phase: 'ready',
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
      isReady: true,
    });

    renderHook(() => useStartupBoundary({}));

    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
      expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
    });

    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('does not try to prevent splash auto-hide from a post-render effect anymore', () => {
    renderHook(() => useStartupBoundary({}));

    expect(SplashScreen.preventAutoHideAsync).not.toHaveBeenCalled();
  });
});
