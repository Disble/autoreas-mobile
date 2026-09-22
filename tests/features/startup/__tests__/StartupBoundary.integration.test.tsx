import { act, render, waitFor } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as dbClientHelpers from '../../../../src/infrastructure/db/client/client.helpers';
import * as dbStartup from '../../../../src/infrastructure/db/startup/startup.helpers';
import * as nativeRuntime from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import { StartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/StartupBoundary.component';
import {
  STARTUP_FAILURE_LOG_PREFIX,
  STARTUP_FONT_LOAD_DEADLINE_MS,
  STARTUP_PROVIDER_READINESS_DEADLINE_MS,
  STARTUP_SOFT_DEADLINE_MS,
} from '../../../../src/features/startup/startup.constants';
import { STARTUP_BOUNDARY_SLOW_DESCRIPTION } from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.constants';

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

/** Renders without ever calling `onInit` and keeps React suspended forever. */
function createNeverInitializingSQLiteProvider() {
  return function MockNeverInitializingSQLiteProvider() {
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

jest.mock('../../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/startup/startup.helpers', () => ({
  prepareForegroundDatabase: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
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

jest.mock('../../../../src/contexts/app-theme-context/app-theme-context', () => ({
  AppThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../../src/features/sync/ui/SyncRuntimeGate/SyncRuntimeGate', () => ({
  SyncRuntimeGate: ({ children }: { children: React.ReactNode }) => {
    mockSyncRuntimeGateRender();
    return children;
  },
}));

describe('StartupBoundary integration', () => {
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

  it('keeps a visible startup placeholder and all database consumers unmounted while SQLite initialization is pending', () => {
    jest.useFakeTimers();
    const migrations = createDeferredPromise<void>();
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createSuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockReturnValue(migrations.promise);

    const view = render(<StartupBoundary />);

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('shows the controlled fallback and leaves sync unmounted when fonts do not settle before the deadline', async () => {
    jest.useFakeTimers();
    (useFonts as jest.Mock).mockReturnValue([false]);
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(null);

    const view = render(<StartupBoundary />);

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    expect(view.getByText('No se pudieron cargar los recursos visuales durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('mounts database consumers and routes exactly once after suspended initialization succeeds', async () => {
    const migrations = createDeferredPromise<void>();
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createSuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockReturnValue(migrations.promise);

    const view = render(<StartupBoundary />);

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

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createSuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockRejectedValue(new Error('SQLITE_ERROR: duplicate column name: device_name'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
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
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    });

    expect(view.getByText('Error al preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the slow-startup notice after the soft deadline without selecting the failure card', async () => {
    jest.useFakeTimers();
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createNeverInitializingSQLiteProvider());

    const view = render(<StartupBoundary />);

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();
    expect(view.queryByText(STARTUP_BOUNDARY_SLOW_DESCRIPTION)).not.toBeOnTheScreen();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_SOFT_DEADLINE_MS);
    });

    expect(view.getByText(STARTUP_BOUNDARY_SLOW_DESCRIPTION)).toBeOnTheScreen();
    expect(view.queryByText('No pudimos iniciar la app')).not.toBeOnTheScreen();
  });

  it('removes the slow-startup notice once startup becomes ready even after the soft deadline elapsed', async () => {
    jest.useFakeTimers();
    const migrations = createDeferredPromise<void>();
    const rawDb = { execAsync: jest.fn().mockResolvedValue(undefined) };
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createSuspendingSQLiteProvider(rawDb));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockReturnValue(migrations.promise);

    const view = render(<StartupBoundary />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_SOFT_DEADLINE_MS);
    });

    expect(view.getByText(STARTUP_BOUNDARY_SLOW_DESCRIPTION)).toBeOnTheScreen();

    await act(async () => {
      migrations.resolve(undefined);
      await migrations.promise;
      await jest.advanceTimersByTimeAsync(STARTUP_SOFT_DEADLINE_MS);
    });

    expect(view.getByText('mocked-slot')).toBeOnTheScreen();
    expect(view.queryByText(STARTUP_BOUNDARY_SLOW_DESCRIPTION)).not.toBeOnTheScreen();
    expect(view.queryByText('No pudimos iniciar la app')).not.toBeOnTheScreen();
  });

  /** Asserts exactly one startup log was emitted for the stage and that no raw error text leaked. */
  function expectSingleStartupLog(stage: string, rawLeak: string) {
    const startupLogs = consoleErrorSpy.mock.calls.filter(
      ([prefix]) => prefix === STARTUP_FAILURE_LOG_PREFIX,
    );

    expect(startupLogs).toHaveLength(1);
    expect(startupLogs[0][1]).toEqual(expect.objectContaining({ stage }));
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(rawLeak);
  }

  it('logs the provider-readiness terminal failure exactly once without leaking raw errors', async () => {
    jest.useFakeTimers();
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createNeverInitializingSQLiteProvider());

    render(<StartupBoundary />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_PROVIDER_READINESS_DEADLINE_MS);
    });
    expectSingleStartupLog('provider_readiness', 'readiness deadline exceeded');
  });

  it('logs the font-loading terminal failure exactly once without leaking raw errors', async () => {
    jest.useFakeTimers();
    (useFonts as jest.Mock).mockReturnValue([false]);
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(null);

    render(<StartupBoundary />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_FONT_LOAD_DEADLINE_MS);
    });

    expectSingleStartupLog('font_loading', 'Font loading deadline exceeded');
  });

  it('releases startup through the provider-readiness watchdog when SQLiteProvider never initializes', async () => {
    jest.useFakeTimers();
    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createNeverInitializingSQLiteProvider());

    const view = render(<StartupBoundary />);

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();
    expect(dbStartup.prepareForegroundDatabase).not.toHaveBeenCalled();
    expect(dbClientHelpers.getBridgeConfigSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STARTUP_PROVIDER_READINESS_DEADLINE_MS - 1);
    });

    expect(view.getByText('Preparando tu biblioteca')).toBeOnTheScreen();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });

    expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
    expect(view.getByText('No se pudo preparar la base local durante el inicio.')).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(view.queryByText('mocked-slot')).not.toBeOnTheScreen();
    expect(mockSyncRuntimeGateRender).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(dbStartup.prepareForegroundDatabase).not.toHaveBeenCalled();
    expect(dbClientHelpers.getBridgeConfigSnapshot).not.toHaveBeenCalled();
  });

  it('shows the same safe startup fallback when connection policy rejects', async () => {
    const rawDb = {
      execAsync: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY: WAL pragma rejected')),
    };

    (nativeRuntime.getSQLiteProvider as jest.Mock).mockReturnValue(createMockSQLiteProvider([rawDb]));
    (dbStartup.prepareForegroundDatabase as jest.Mock).mockRejectedValue(new Error('SQLITE_BUSY: WAL pragma rejected'));

    const view = render(<StartupBoundary />);

    await waitFor(() => {
      expect(view.getByText('No pudimos iniciar la app')).toBeOnTheScreen();
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
