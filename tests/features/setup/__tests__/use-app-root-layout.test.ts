import { renderHook, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useDbBootstrap } from '../../../../src/features/setup/use-db-bootstrap';
import { useAppRootLayout } from '../../../../src/features/setup/ui/AppRootLayout/use-app-root-layout';

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

jest.mock('../../../../src/features/setup/use-db-bootstrap', () => ({
  useDbBootstrap: jest.fn(),
}));

describe('useAppRootLayout', () => {
  const replace = jest.fn();
  const mockSQLiteProvider = 'SQLiteProvider';

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (useDbBootstrap as jest.Mock).mockReturnValue({
      bootState: {
        failure: null,
        initialized: false,
        target: null,
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
    });
  });

  it('hides the splash screen and skips navigation when bootstrap fails', async () => {
    (useDbBootstrap as jest.Mock).mockReturnValue({
      bootState: {
        failure: {
          diagnosticMessage: 'Error al preparar la base local durante el inicio.',
          recoveryHint:
            'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.',
        },
        initialized: false,
        target: null,
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
    });

    renderHook(() => useAppRootLayout({}));

    await waitFor(() => {
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the success navigation flow unchanged when bootstrap finishes', async () => {
    (useDbBootstrap as jest.Mock).mockReturnValue({
      bootState: {
        failure: null,
        initialized: true,
        target: '/setup',
      },
      databaseName: 'autoreas.db',
      handleDatabaseInit: jest.fn(),
      sqliteOptions: { enableChangeListener: true },
      sqliteProvider: mockSQLiteProvider,
    });

    renderHook(() => useAppRootLayout({}));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/setup');
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('does not try to prevent splash auto-hide from a post-render effect anymore', () => {
    renderHook(() => useAppRootLayout({}));

    expect(SplashScreen.preventAutoHideAsync).not.toHaveBeenCalled();
  });
});
