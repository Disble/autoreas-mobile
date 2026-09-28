import { render, waitFor } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as dbClientHelpers from '../../../../src/infrastructure/db/client/client.helpers';
import * as dbStartup from '../../../../src/infrastructure/db/startup/startup.helpers';
import * as nativeRuntime from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { StartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/StartupBoundary.component';

/** Describes a promise whose settlement is controlled manually by a test. */
interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

/** Creates a deferred promise so tests can hold startup work in flight and settle it manually. */
function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>['resolve'];
  let reject!: DeferredPromise<T>['reject'];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

/** Describes the props the mock SQLite providers accept from the startup boundary. */
type MockSQLiteProviderProps = Readonly<{
  children: React.ReactNode;
  onInit?: (db: unknown) => Promise<void>;
}>;

/** Renders its children and calls `onInit` once for every provided mock database. */
function createMockSQLiteProvider(databases: readonly unknown[]) {
  return function MockSQLiteProvider({ children, onInit }: MockSQLiteProviderProps) {
    useEffect(() => {
      if (!onInit) {
        return;
      }

      for (const database of databases) {
        onInit(database).catch(() => undefined);
      }
    }, [onInit]);

    return <>{children}</>;
  };
}

/** Renders children only after `onInit` settles, throwing the pending promise to suspend React. */
function createSuspendingSQLiteProvider(database: unknown) {
  let initializationPromise: Promise<void> | null = null;
  let initialized = false;

  return function MockSuspendingSQLiteProvider(props: MockSQLiteProviderProps) {
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

/** Starts `onInit` once but keeps throwing a never-settling promise so React stays suspended. */
function createPermanentlySuspendingSQLiteProvider(database: unknown) {
  let hasStartedInitialization = false;

  return function MockPermanentlySuspendingSQLiteProvider(props: MockSQLiteProviderProps) {
    if (!hasStartedInitialization) {
      hasStartedInitialization = true;
      props.onInit?.(database).catch(() => undefined);
    }

    throw new Promise<never>(() => undefined);
  };
}

/** Tracks how many times the sync runtime gate rendered, proving sync stays unmounted on failure. */
const mockSyncRuntimeGateRender = jest.fn();

jest.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
  useFonts: jest.fn(() => [true]),
}));

jest.mock('expo-router', () => ({
  Slot: jest.fn(function MockedSlot() {
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
  const { createElement } = require('react'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ReactNative = require('react-native');

  const wrap =
    (Component: typeof ReactNative.View | typeof ReactNative.Text) =>
    function WrappedHeroUIComponent({ children, ...props }: { children: React.ReactNode }) {
      return createElement(Component, props, children);
    };

  const Card = Object.assign(wrap(ReactNative.View), {
    Body: wrap(ReactNative.View), Description: wrap(ReactNative.Text),
    Footer: wrap(ReactNative.View), Header: wrap(ReactNative.View), Title: wrap(ReactNative.Text),
  });

  const Alert = Object.assign(wrap(ReactNative.View), {
    Content: wrap(ReactNative.View), Description: wrap(ReactNative.Text),
    Indicator: wrap(ReactNative.View), Title: wrap(ReactNative.Text),
  });

  // The terminal recovery card renders HeroUI `Button`/`Button.Label` for every state that
  // authorizes an action (transient retry, damage reset, failed-reset retry). Without this the
  // recovery tests would fail on an undefined component rather than on their copy.
  const Button = Object.assign(wrap(ReactNative.View), {
    Label: wrap(ReactNative.Text),
  });

  return {
    Alert,
    Button,
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

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/startup/startup.helpers', () => ({
  prepareForegroundDatabase: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getSQLiteProvider: jest.fn(),
  // The recovery surface renders OUTSIDE `SQLiteProvider`, which is exactly the production
  // reality: the optional context is null while a fatal card replaces the provider. Without this
  // stub the real module's other export is `undefined`, so the recovery hook throws before any
  // assertion runs.
  useOptionalSQLiteContext: jest.fn(() => null),
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

jest.mock('../../../../src/contexts/app-theme-context/app-theme-context', () => ({
  AppThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../../src/features/sync/ui/SyncRuntimeGate/SyncRuntimeGate', () => ({
  SyncRuntimeGate: ({ children }: { children: React.ReactNode }) => {
    mockSyncRuntimeGateRender();
    return children;
  },
}));

describe('StartupBoundary integration recovery', () => {
  const replace = jest.fn();
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (useFonts as jest.Mock).mockReturnValue([true]);
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockResolvedValue(undefined);
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows the HeroUI fallback, hides splash, and skips navigation when migrations reject from SQLiteProvider.onInit', async () => {
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createSuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockRejectedValue(new Error('SQLITE_ERROR: duplicate column name: device_name'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No hace falta borrar tus datos')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the controlled fallback outside a permanently suspended SQLiteProvider', async () => {
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createPermanentlySuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockRejectedValue(new Error('SQLITE_ERROR: migration crash'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No hace falta borrar tus datos')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the same safe startup fallback when connection policy rejects', async () => {
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY: WAL pragma rejected')),
    };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([rawDb]));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockRejectedValue(new Error('SQLITE_BUSY: WAL pragma rejected'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('La base local está ocupada')).toBeOnTheScreen();
    });

    expect(dbClientHelpers.getBridgeConfigSnapshot).not.toHaveBeenCalled();
    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the same safe startup fallback, hides splash, and skips navigation when reading the bridge config snapshot rejects from SQLiteProvider.onInit', async () => {
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([rawDb]));
    (dbClientHelpers.getBridgeConfigSnapshot as jest.Mock).mockRejectedValue(new Error('Missing bridge_config row'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No hace falta borrar tus datos')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al leer la configuración local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the visible failure state and never routes when an earlier bootstrap succeeds after a newer failure', async () => {
    const lateSuccess = createDeferredPromise<{ deviceId: string }>();
    const slowerRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    const failingRawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([slowerRawDb, failingRawDb]));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockImplementation(async (database) => {
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

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No hace falta borrar tus datos')).toBeOnTheScreen();
    });

    lateSuccess.resolve({ deviceId: 'device-1' });

    await waitFor(() => {
      expect(replace).not.toHaveBeenCalled();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
  });
});
