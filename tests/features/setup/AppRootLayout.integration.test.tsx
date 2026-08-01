import { act, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as dbClientHelpers from '../../../src/infrastructure/db/client/client.helpers';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { AppRootLayout } from '../../../src/features/setup/ui/AppRootLayout';

interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>['resolve'];
  let reject!: DeferredPromise<T>['reject'];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createMockSQLiteProvider(databases: readonly unknown[]) {
  return function MockSQLiteProvider(
    props: Readonly<{ children: React.ReactNode; onInit?: (db: unknown) => Promise<void> }>,
  ) {
    useEffect(() => {
      if (!props.onInit) {
        return;
      }

      for (const database of databases) {
        props.onInit(database).catch(() => undefined);
      }
    }, [props.onInit]);

    return <>{props.children}</>;
  };
}

function createSuspendingSQLiteProvider(database: unknown) {
  let initializationPromise: Promise<void> | null = null;
  let initialized = false;

  return function MockSuspendingSQLiteProvider(
    props: Readonly<{ children: React.ReactNode; onInit?: (db: unknown) => Promise<void> }>,
  ) {
    if (!initializationPromise) {
      initializationPromise = (props.onInit?.(database) ?? Promise.resolve()).then(() => {
        initialized = true;
      });
    }

    if (!initialized) {
      throw initializationPromise;
    }

    return <>{props.children}</>;
  };
}

const mockSyncRuntimeGateRender = jest.fn();

jest.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
  useFonts: jest.fn(() => [true]),
}));

jest.mock('expo-router', () => ({
  Slot: jest.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native');

    return <ReactNative.Text>mocked-slot</ReactNative.Text>;
  }),
  useRouter: jest.fn(),
}));

jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(async () => undefined),
  preventAutoHideAsync: jest.fn(async () => undefined),
  setOptions: jest.fn(),
}));

jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactNative = require('react-native');

  const wrap =
    (Component: typeof ReactNative.View | typeof ReactNative.Text) =>
    ({ children, ...props }: { children: React.ReactNode }) =>
      createElement(Component, props, children);

  const Card = Object.assign(wrap(ReactNative.View), {
    Body: wrap(ReactNative.View),
    Description: wrap(ReactNative.Text),
    Footer: wrap(ReactNative.View),
    Header: wrap(ReactNative.View),
    Title: wrap(ReactNative.Text),
  });

  const Alert = Object.assign(wrap(ReactNative.View), {
    Content: wrap(ReactNative.View),
    Description: wrap(ReactNative.Text),
    Indicator: wrap(ReactNative.View),
    Title: wrap(ReactNative.Text),
  });

  return {
    Alert,
    Card,
    HeroUINativeProvider: ({ children }: { children: React.ReactNode }) => children,
    Spinner: wrap(ReactNative.View),
    Typography: Object.assign(wrap(ReactNative.Text), {
      Heading: wrap(ReactNative.Text),
      Paragraph: wrap(ReactNative.Text),
    }),
    cn: (...classNames: string[]) => classNames.filter(Boolean).join(' '),
  };
});

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  runMigrations: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getSQLiteProvider: jest.fn(),
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => children,
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../src/contexts/app-theme-context/app-theme-context', () => ({
  AppThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../src/features/sync/ui/SyncRuntimeGate/SyncRuntimeGate', () => ({
  SyncRuntimeGate: ({ children }: { children: React.ReactNode }) => {
    mockSyncRuntimeGateRender();
    return children;
  },
}));

describe('AppRootLayout startup integration', () => {
  const replace = jest.fn();
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (dbClientHelpers.runMigrations as jest.Mock).mockResolvedValue(undefined);
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('keeps a visible startup placeholder and all database consumers unmounted while SQLite initialization is pending', () => {
    const migrations = createDeferredPromise<void>();
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(
      createSuspendingSQLiteProvider(rawDb),
    );
    (dbClientHelpers.runMigrations as jest.Mock).mockReturnValue(migrations.promise);

    const view = render(<AppRootLayout />);

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('mounts database consumers and routes exactly once after suspended initialization succeeds', async () => {
    const migrations = createDeferredPromise<void>();
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(
      createSuspendingSQLiteProvider(rawDb),
    );
    (dbClientHelpers.runMigrations as jest.Mock).mockReturnValue(migrations.promise);

    const view = render(<AppRootLayout />);

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();

    await act(async () => {
      migrations.resolve(undefined);
      await migrations.promise;
    });

    await waitFor(() => {
      expect(view.getByText('mocked-slot')).toBeOnTheScreen();
    });

    expect(view.queryByText('Preparando tu biblioteca')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/setup');
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('shows the HeroUI fallback, hides splash, and skips navigation when migrations reject from SQLiteProvider.onInit', async () => {
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(
      createSuspendingSQLiteProvider(rawDb),
    );
    (dbClientHelpers.runMigrations as jest.Mock).mockRejectedValue(
      new Error('SQLITE_ERROR: duplicate column name: device_name'),
    );

    const view = render(<AppRootLayout />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the same safe startup fallback when enabling WAL rejects', async () => {
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY: WAL pragma rejected')),
    };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([rawDb]));

    const view = render(<AppRootLayout />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    });

    expect(dbClientHelpers.runMigrations).not.toHaveBeenCalled();
    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the same safe startup fallback, hides splash, and skips navigation when reading the bridge config snapshot rejects from SQLiteProvider.onInit', async () => {
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([rawDb]));
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockRejectedValue(
      new Error('Missing bridge_config row'),
    );

    const view = render(<AppRootLayout />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al leer la configuración local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the visible failure state and never routes when an earlier bootstrap succeeds after a newer failure', async () => {
    const lateSuccess = createDeferredPromise<{ deviceId: string }>();
    const slowerRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    const failingRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(
      createMockSQLiteProvider([slowerRawDb, failingRawDb]),
    );
    (dbClientHelpers.runMigrations as jest.Mock).mockImplementation(async (database) => {
      if (database === failingRawDb) {
        throw new Error('SQLITE_ERROR: migration crash');
      }

      return undefined;
    });
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockImplementation(async (database) => {
      if (database === slowerRawDb) {
        return lateSuccess.promise;
      }

      return null;
    });

    const view = render(<AppRootLayout />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    });

    lateSuccess.resolve({ deviceId: 'device-1' });

    await waitFor(() => {
      expect(replace).not.toHaveBeenCalled();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
  });
});
