import { renderHook, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useStartup } from '../../../../src/features/startup/use-startup';
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

  it('does not try to prevent splash auto-hide from a post-render effect anymore', () => {
    renderHook(() => useStartupBoundary({}));

    expect(SplashScreen.preventAutoHideAsync).not.toHaveBeenCalled();
  });
});
