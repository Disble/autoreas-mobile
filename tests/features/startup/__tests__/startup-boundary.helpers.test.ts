import { act, renderHook } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/inter';
import { useRouter } from 'expo-router';
import { createElement, Fragment, useCallback, useState, type ReactElement } from 'react';
import {
  createStartupRecoveryState,
  type StartupRecoveryCause,
  type StartupRecoveryState,
  type UseStartupRecoveryResult,
} from '../../../../src/features/startup/recovery';
import { createStartupDiagnostic } from '../../../../src/features/startup/startup.helpers';
import type {
  StartupFailure,
  StartupFailureClassification,
  StartupState,
  UseStartupResult,
} from '../../../../src/features/startup/startup.types';
import { useStartup } from '../../../../src/features/startup/use-startup';
import { StartupBoundaryFallback } from '../../../../src/features/startup/ui/StartupBoundary/StartupBoundaryFallback';
import {
  resolveStartupBoundaryContent,
  resolveStartupBoundaryRecovery,
  resolveStartupBoundaryScreen,
} from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.helpers';
import type { StartupBoundaryFallbackProps } from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary-fallback.types';
import type { StartupBoundaryRecovery } from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.types';
import { useStartupBoundary } from '../../../../src/features/startup/ui/StartupBoundary/use-startup-boundary';
import type { DatabaseResetPorts } from '../../../../src/infrastructure/db/recovery';
import { createDatabaseResetAdapters } from '../../../../src/infrastructure/db/recovery/recovery.adapters';
import { SchemaValidationError } from '../../../../src/infrastructure/db/startup';

/** Defines the props the mocked keyboard-controller primitives accept. */
interface MockKeyboardProps {
  readonly children?: React.ReactNode;
}

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: MockKeyboardProps) => children,
  KeyboardProvider: ({ children }: MockKeyboardProps) => children,
}));

jest.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: {},
  Inter_500Medium: {},
  Inter_600SemiBold: {},
  Inter_700Bold: {},
  useFonts: jest.fn(() => [true]),
}));

jest.mock('expo-router', () => ({
  Slot: jest.fn(() => null),
  useRouter: jest.fn(),
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

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getSQLiteProvider: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/recovery/recovery.adapters', () => ({
  createDatabaseResetAdapters: jest.fn(),
}));

/** Exposes the adapters factory as a mock so each test installs its own fake ports. */
const createDatabaseResetAdaptersMock = createDatabaseResetAdapters as jest.Mock;
/** Supplies the startup result each boundary test starts from. */
const useStartupMock = useStartup as jest.Mock;
/** Reports fonts as loaded so the boundary is never stalled on them. */
const useFontsMock = useFonts as jest.Mock;
/** Captures the navigation the boundary performs once startup resolves its target. */
const useRouterMock = useRouter as jest.Mock;

/** Builds the terminal failure a start-up database failure reports. */
function createDatabaseFailure(classification: StartupFailureClassification): StartupFailure {
  return {
    diagnostic: { classification, code: null, stage: 'database_preparation' },
    diagnosticMessage: 'Error al preparar la base local durante el inicio.',
    recoveryHint:
      'Cierra y vuelve a abrir la app. Si vuelve a pasar, avisa que falló el inicio local.',
  };
}

/** Builds a complete recovery result around one presentation, so the resolver reads real input. */
function createRecoveryResult(recoveryState: StartupRecoveryState): UseStartupRecoveryResult {
  return {
    cancelReset: jest.fn(),
    confirmReset: jest.fn(async () => undefined),
    isResetConfirmationVisible: false,
    openAppSettings: jest.fn(async () => undefined),
    recoveryState,
    requestReset: jest.fn(),
    retryReset: jest.fn(async () => undefined),
    retryStartup: jest.fn(),
  };
}

/** Builds the recovery state the logic produces for one cause of a fresh startup attempt. */
function createRecoveryResultForCause(
  cause: StartupRecoveryCause | null,
): UseStartupRecoveryResult {
  return createRecoveryResult(
    createStartupRecoveryState({
      attempt: { status: 'not_started' },
      canMountFreshProvider: true,
      cause,
    }),
  );
}

/** Builds a complete fake port set, so a controlled reset runs through the real orchestrator. */
function createFakePorts(overrides: Partial<DatabaseResetPorts> = {}): DatabaseResetPorts {
  return {
    clearResetIntent: jest.fn(async () => undefined),
    closeDatabaseConnections: jest.fn(async () => undefined),
    deleteDatabase: jest.fn(async () => undefined),
    isDatabasePresent: jest.fn(async () => true),
    now: jest.fn(() => 1_700_000_000_000),
    openAndPrepare: jest.fn(async () => undefined),
    readResetIntent: jest.fn(async () => null),
    stopNativeWriters: jest.fn(async () => undefined),
    writeResetIntent: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** Stands in for `expo-sqlite`'s provider; the boundary tests never render the root tree. */
function MockSQLiteProvider(props: Readonly<{ children?: React.ReactNode }>) {
  return createElement(Fragment, null, props.children);
}

/** Builds a mocked startup result so the boundary tests control the startup state directly. */
function createStartupResult(overrides: Partial<UseStartupResult> = {}): UseStartupResult {
  return {
    databaseName: 'autoreas.db',
    getActiveDatabase: jest.fn(() => null),
    handleDatabaseInit: jest.fn(async () => undefined),
    isReady: false,
    remountDatabaseProvider: jest.fn(),
    sqliteOptions: { enableChangeListener: true },
    sqliteProvider: MockSQLiteProvider,
    startupState: { failure: null, phase: 'preparing_database', target: null },
    ...overrides,
  };
}

/**
 * Reads the recovery presentation out of the pre-provider element the boundary resolved.
 * The element comes from the production resolver, so this asserts the component contract the
 * boundary promised instead of re-deriving the decision.
 */
function readBoundaryRecovery(content: ReactElement | null): StartupBoundaryRecovery | null {
  if (content === null || content.type !== StartupBoundaryFallback) {
    return null;
  }

  return (content.props as StartupBoundaryFallbackProps).recovery;
}

/**
 * Installs a startup result whose remount reports the state a genuinely fresh provider produces.
 *
 * A successful reset and a transient retry both end in a fresh provider over a fresh database, so
 * the mocked provider answers with the ordinary first-run target: setup, never the catalog.
 */
function installRemountableStartup(failure: StartupFailure): {
  readonly remountDatabaseProvider: jest.Mock;
} {
  const remountDatabaseProvider = jest.fn();

  useStartupMock.mockImplementation(() => {
    const [startupState, setStartupState] = useState<StartupState>(
      failure === null
        ? { failure: null, phase: 'ready', target: '/setup' }
        : { failure, phase: 'fatal', target: null },
    );

    return createStartupResult({
      isReady: startupState.phase === 'ready',
      remountDatabaseProvider: useCallback(() => {
        remountDatabaseProvider();
        setStartupState({ failure: null, phase: 'ready', target: '/setup' });
      }, []),
      startupState,
    });
  });

  return { remountDatabaseProvider };
}

describe('startup boundary helpers', () => {
  it('reduces native SQLite failures to whitelisted stage and code diagnostics', () => {
    const error = new Error(
      'SQLITE_BUSY: UPDATE bridge_config SET token = secret-token at 192.168.1.10',
    );

    expect(createStartupDiagnostic('database_preparation', error)).toEqual({
      stage: 'database_preparation',
      code: 'SQLITE_BUSY',
      classification: 'busy',
    });
  });

  it('classifies controlled schema validation failures without exposing a native message', () => {
    expect(
      createStartupDiagnostic('database_preparation', new SchemaValidationError()),
    ).toEqual({
      stage: 'database_preparation',
      code: null,
      classification: 'schema_validation',
    });
  });

  it('resolves the recovery screen only when the recovery layer has a presentation to render', () => {
    const startupFailure = createDatabaseFailure('corruption');

    expect(
      resolveStartupBoundaryScreen({
        fontsLoaded: true,
        hasRenderableRecovery: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: false,
        startupFailure,
      }),
    ).toBe('startup-recovery');

    // Without a renderable presentation the same failure keeps the generic explanation screen.
    expect(
      resolveStartupBoundaryScreen({
        fontsLoaded: true,
        hasSQLiteProvider: true,
        shouldRenderRouteSlot: false,
        startupFailure,
      }),
    ).toBe('startup-failure');
  });

  it('groups a terminal recovery state with the actions that state authorized', () => {
    const damage = createRecoveryResultForCause({
      classification: 'corruption',
      kind: 'startup_failure',
    });

    expect(resolveStartupBoundaryRecovery(damage)).toEqual({
      actions: damage,
      state: damage.recoveryState,
    });
  });

  it('answers with no presentation for the states that are not terminal cards', () => {
    // Neither a healthy startup nor a Bridge-off first run is a failure card, so neither may be
    // presented as one; they keep the routing the boundary already owns.
    expect(resolveStartupBoundaryRecovery(createRecoveryResultForCause(null))).toBeNull();
    expect(
      resolveStartupBoundaryRecovery(createRecoveryResultForCause({ kind: 'bridge_unavailable' })),
    ).toBeNull();
  });

  it('attaches the recovery presentation to the fallback element of the recovery screen', () => {
    const startupFailure = createDatabaseFailure('corruption');
    const recovery = createRecoveryResultForCause({
      classification: 'corruption',
      kind: 'startup_failure',
    });
    const presentation = resolveStartupBoundaryRecovery(recovery);

    expect(presentation).not.toBeNull();

    const content = resolveStartupBoundaryContent({
      recovery: presentation,
      screen: 'startup-recovery',
      startupFailure,
    });

    expect(content.providerContent).toBeNull();
    expect(content.preProviderContent?.type).toBe(StartupBoundaryFallback);
    expect((content.preProviderContent?.props as StartupBoundaryFallbackProps).recovery).toBe(
      presentation,
    );
  });

  it('falls back to the generic failure card when no recovery presentation exists', () => {
    const content = resolveStartupBoundaryContent({
      screen: 'startup-recovery',
      startupFailure: createDatabaseFailure('corruption'),
    });

    expect(content.preProviderContent?.type).toBe(StartupBoundaryFallback);
    expect((content.preProviderContent?.props as StartupBoundaryFallbackProps).recovery).toBeNull();
  });
});

describe('startup boundary recovery wiring', () => {
  const replace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useFontsMock.mockReturnValue([true]);
    useRouterMock.mockReturnValue({ replace });
    createDatabaseResetAdaptersMock.mockReturnValue(createFakePorts());
    useStartupMock.mockReturnValue(createStartupResult());
  });

  it('resolves the recovery screen for a confirmed corruption failure', () => {
    useStartupMock.mockReturnValue(
      createStartupResult({
        startupState: {
          failure: createDatabaseFailure('corruption'),
          phase: 'fatal',
          target: null,
        },
      }),
    );

    const { result } = renderHook(() => useStartupBoundary({}));

    expect(result.current.screen).toBe('startup-recovery');
    expect(result.current.providerContent).toBeNull();
    expect(readBoundaryRecovery(result.current.preProviderContent)?.state.kind).toBe('damage');
  });

  it('resolves the recovery screen without authorizing a reset for a refused failure', () => {
    useStartupMock.mockReturnValue(
      createStartupResult({
        startupState: {
          failure: createDatabaseFailure('schema_validation'),
          phase: 'fatal',
          target: null,
        },
      }),
    );

    const { result } = renderHook(() => useStartupBoundary({}));

    expect(result.current.screen).toBe('startup-recovery');
    expect(readBoundaryRecovery(result.current.preProviderContent)?.state.kind).toBe('no_reset');
  });

  it('keeps the generic failure card for a font failure the startup state never reported', () => {
    useFontsMock.mockReturnValue([false, new Error('font loading exploded')]);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useStartupBoundary({}));

    // A font failure is not a database situation, so it must not present database recovery copy
    // even though the boundary does treat it as a terminal startup failure.
    expect(result.current.screen).toBe('startup-failure');
    expect(result.current.startupFailure).not.toBeNull();
    expect(readBoundaryRecovery(result.current.preProviderContent)).toBeNull();
    consoleError.mockRestore();
  });

  it('keeps a Bridge-off startup on the ordinary setup route instead of a recovery card', () => {
    useStartupMock.mockReturnValue(
      createStartupResult({
        isReady: true,
        startupState: { failure: null, phase: 'ready', target: '/setup' },
      }),
    );

    const { result } = renderHook(() => useStartupBoundary({}));

    expect(result.current.screen).toBe('route-slot');
    expect(readBoundaryRecovery(result.current.preProviderContent)).toBeNull();
    expect(replace).toHaveBeenCalledWith('/setup');
  });

  it('remounts a fresh provider and routes to setup after a successful reset, never to the catalog', async () => {
    const { remountDatabaseProvider } = installRemountableStartup(
      createDatabaseFailure('corruption'),
    );

    const { result } = renderHook(() => useStartupBoundary({}));
    const recovery = readBoundaryRecovery(result.current.preProviderContent);

    expect(recovery?.state.kind).toBe('damage');
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      recovery?.actions.requestReset();
    });
    // The confirmation callback comes from the render that saw the visible confirmation, because
    // the hook reads its own visibility before it runs anything.
    await act(async () => {
      await readBoundaryRecovery(result.current.preProviderContent)?.actions.confirmReset();
    });

    expect(remountDatabaseProvider).toHaveBeenCalledTimes(1);
    // The reset ends in the ordinary first-run path: an empty catalog must never be presented as
    // completed recovery, so the fresh provider's `/setup` target is the only navigation.
    expect(replace).toHaveBeenCalledWith('/setup');
    expect(replace).not.toHaveBeenCalledWith('/(tabs)');
  });

  it('retries a transient busy failure through the same fresh-provider remount', () => {
    const { remountDatabaseProvider } = installRemountableStartup(createDatabaseFailure('busy'));

    const { result } = renderHook(() => useStartupBoundary({}));
    const recovery = readBoundaryRecovery(result.current.preProviderContent);

    expect(recovery?.state.kind).toBe('transient');

    act(() => {
      recovery?.actions.retryStartup();
    });

    expect(remountDatabaseProvider).toHaveBeenCalledTimes(1);
  });
});
