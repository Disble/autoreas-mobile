import { act, fireEvent, render } from '@testing-library/react-native';
import { type ReactNode } from 'react';
import { Linking } from 'react-native';
import {
  useStartupRecovery,
  type StartupRecoveryCause,
} from '../../../../src/features/startup/recovery';
import type { StartupFailure } from '../../../../src/features/startup/startup.types';
import { StartupBoundaryFallback } from '../../../../src/features/startup/ui/StartupBoundary/StartupBoundaryFallback';
import { resolveStartupBoundaryRecovery } from '../../../../src/features/startup/ui/StartupBoundary/startup-boundary.helpers';
import type { DatabaseResetPorts } from '../../../../src/infrastructure/db/recovery';
import { createDatabaseResetAdapters } from '../../../../src/infrastructure/db/recovery/recovery.adapters';
import { useOptionalSQLiteContext } from '../../../../src/infrastructure/db/native-runtime/native-runtime.helpers';

/** Defines the props every mocked HeroUI primitive in this file accepts. */
interface MockPrimitiveProps {
  readonly children?: ReactNode;
  readonly className?: string;
}

/** Names the open-state callback the mocked dialog forwards to its own close control. */
type MockDialogOnOpenChange = (isOpen: boolean) => void;

/** Defines the props the mocked dialog root accepts. */
interface MockDialogRootProps {
  readonly children?: ReactNode;
  readonly isOpen?: boolean;
  readonly onOpenChange?: MockDialogOnOpenChange;
}

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({ children }: MockPrimitiveProps) => children,
  KeyboardProvider: ({ children }: MockPrimitiveProps) => children,
}));

jest.mock('../../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getSQLiteProvider: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/recovery/recovery.adapters', () => ({
  createDatabaseResetAdapters: jest.fn(),
}));

/**
 * Stands in for the HeroUI Native design system with the primitives this surface renders.
 *
 * `Dialog` is reproduced rather than passed through: the real one renders through a portal that
 * only exists inside the library provider, and the two behaviors that matter here are exactly the
 * ones its contract defines -- a closed dialog renders nothing, and closing it by any route
 * reports `onOpenChange(false)`.
 */
jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('heroui-native');

  const view = (testID: string) => {
    const Wrapped = ({ children, className: _className, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.View, { testID, ...props }, children);
    Wrapped.displayName = testID;
    return Wrapped;
  };

  const text = (testID: string) => {
    const Wrapped = ({ children, className: _className, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.Text, { testID, ...props }, children);
    Wrapped.displayName = testID;
    return Wrapped;
  };

  const pressable = (testID: string) => {
    const Wrapped = ({ children, className: _className, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.Pressable, { testID, ...props }, children);
    Wrapped.displayName = testID;
    return Wrapped;
  };

  const Card = Object.assign(view('card'), {
    Body: view('card-body'),
    Description: text('card-description'),
    Title: text('card-title'),
  });

  const Alert = Object.assign(view('alert'), {
    Content: view('alert-content'),
    Description: text('alert-description'),
    Indicator: view('alert-indicator'),
    Title: text('alert-title'),
  });

  const Button = Object.assign(pressable('button'), { Label: text('button-label') });

  const DialogOpenChange = React.createContext<MockDialogOnOpenChange>(() => undefined);

  const DialogClose = () => {
    const onOpenChange = React.useContext(DialogOpenChange);

    return React.createElement(
      RN.Pressable,
      { testID: 'dialog-close', onPress: () => onOpenChange(false) },
      null,
    );
  };

  const DialogRoot = ({ children, isOpen, onOpenChange, ...props }: MockDialogRootProps) =>
    isOpen === true
      ? React.createElement(
          DialogOpenChange.Provider,
          { value: onOpenChange ?? (() => undefined) },
          React.createElement(RN.View, { testID: 'dialog', ...props }, children),
        )
      : null;

  const Dialog = Object.assign(DialogRoot, {
    Close: DialogClose,
    Content: view('dialog-content'),
    Description: text('dialog-description'),
    Overlay: view('dialog-overlay'),
    Portal: ({ children }: MockPrimitiveProps) => children,
    Title: text('dialog-title'),
  });

  return {
    ...actual,
    Alert,
    Button,
    Card,
    Dialog,
    cn: (...classNames: string[]) => classNames.filter(Boolean).join(' '),
  };
});

/** Exposes the adapters factory as a mock so each test installs its own fake ports. */
const createDatabaseResetAdaptersMock = createDatabaseResetAdapters as jest.Mock;
/** Reports no provider connection, which is what a recovery card outside the provider sees. */
const useOptionalSQLiteContextMock = useOptionalSQLiteContext as jest.Mock;

/** Names the only startup failure that authorizes a destructive reset. */
const CORRUPTION_CAUSE: StartupRecoveryCause = {
  classification: 'corruption',
  kind: 'startup_failure',
};

/** Names a transient startup failure the user may retry. */
const BUSY_CAUSE: StartupRecoveryCause = { classification: 'busy', kind: 'startup_failure' };

/** Names every database failure that must never authorize a destructive reset. */
const REFUSED_CAUSES: readonly StartupRecoveryCause[] = [
  { classification: 'sqlite', kind: 'startup_failure' },
  { classification: 'unknown', kind: 'startup_failure' },
  { classification: 'schema_validation', kind: 'startup_failure' },
  { classification: 'incompatible_schema', kind: 'startup_failure' },
];

/** Builds the terminal failure the boundary reports when the local database stopped startup. */
const DATABASE_FAILURE: StartupFailure = {
  diagnostic: { classification: 'corruption', code: null, stage: 'database_preparation' },
  diagnosticMessage: 'Error al preparar la base local durante el inicio.',
  recoveryHint: 'Cierra y vuelve a abrir la app. Si vuelve a pasar, avisa que falló el inicio local.',
};

/** Builds a complete fake port set so a controlled reset can run through the real orchestrator. */
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

/** Holds one port promise open so a test can observe the destructive window while it runs. */
function createDeferredPort(): { readonly promise: Promise<void>; readonly settle: () => void } {
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/** Renders the startup fallback over the real recovery logic so tests drive real transitions. */
function RecoveryFallbackHarness(
  props: Readonly<{ cause: StartupRecoveryCause; remountProvider?: () => void }>,
) {
  const recovery = useStartupRecovery({
    cause: props.cause,
    remountProvider: props.remountProvider,
  });

  return (
    <StartupBoundaryFallback
      failure={DATABASE_FAILURE}
      recovery={resolveStartupBoundaryRecovery(recovery)}
    />
  );
}

describe('StartupBoundaryFallback recovery surface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOptionalSQLiteContextMock.mockReturnValue(null);
    createDatabaseResetAdaptersMock.mockReturnValue(createFakePorts());
  });

  it('offers the reset as a single confirmation for a confirmed corruption failure', () => {
    const view = render(<RecoveryFallbackHarness cause={CORRUPTION_CAUSE} />);

    expect(view.getByText('Los datos locales de este dispositivo están dañados')).toBeOnTheScreen();
    expect(view.getByText('Volver a configurar Mobile')).toBeOnTheScreen();
    expect(view.getByText('Ahora no')).toBeOnTheScreen();
    // The destructive confirmation is a second, explicit step: it is not on screen yet, and
    // rendering the offer deletes nothing on its own.
    expect(view.queryByText('¿Volver a configurar Mobile?')).not.toBeOnTheScreen();
    expect(view.queryByText('Borrar y volver a configurar')).not.toBeOnTheScreen();
  });

  it.each(REFUSED_CAUSES)(
    'never offers a reset for the $classification failure the reset boundary refuses',
    (cause) => {
      const view = render(<RecoveryFallbackHarness cause={cause} />);

      expect(view.getByText('No hace falta borrar tus datos')).toBeOnTheScreen();
      expect(view.queryByText('Volver a configurar Mobile')).not.toBeOnTheScreen();
      expect(view.queryByText('Borrar y volver a configurar')).not.toBeOnTheScreen();
      expect(view.queryByText('¿Volver a configurar Mobile?')).not.toBeOnTheScreen();
      expect(view.queryByText('Reintentar')).not.toBeOnTheScreen();
    },
  );

  it('requires the explicit confirmation and states that unsent local changes may be lost', async () => {
    const ports = createFakePorts();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    const view = render(<RecoveryFallbackHarness cause={CORRUPTION_CAUSE} />);

    await act(async () => {
      fireEvent.press(view.getByText('Volver a configurar Mobile'));
    });

    expect(view.getByText('¿Volver a configurar Mobile?')).toBeOnTheScreen();
    // The warning states a possibility about the user's own unsent work and says plainly that the
    // Bridge does not hold it: the app can never prove the Bridge received a local write.
    expect(view.getByText(/pueden perderse: el Bridge no los tiene/)).toBeOnTheScreen();
    expect(ports.deleteDatabase).not.toHaveBeenCalled();
    expect(ports.stopNativeWriters).not.toHaveBeenCalled();
  });

  it('leaves the app untouched when the confirmation is cancelled', async () => {
    const ports = createFakePorts();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    const view = render(<RecoveryFallbackHarness cause={CORRUPTION_CAUSE} />);

    await act(async () => {
      fireEvent.press(view.getByText('Volver a configurar Mobile'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Cancelar'));
    });

    expect(ports.deleteDatabase).not.toHaveBeenCalled();
    expect(ports.stopNativeWriters).not.toHaveBeenCalled();
    expect(view.queryByText('Borrar y volver a configurar')).not.toBeOnTheScreen();
    // The offer is spent for this attempt: it is not presented again in the same startup.
    expect(view.queryByText('Volver a configurar Mobile')).not.toBeOnTheScreen();
    expect(view.getByText('No volvimos a configurar Mobile')).toBeOnTheScreen();
  });

  it('leaves the app untouched when the confirmation is dismissed without cancelling it', async () => {
    const ports = createFakePorts();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    const view = render(<RecoveryFallbackHarness cause={CORRUPTION_CAUSE} />);

    await act(async () => {
      fireEvent.press(view.getByText('Volver a configurar Mobile'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('dialog-close'));
    });

    expect(ports.deleteDatabase).not.toHaveBeenCalled();
    expect(view.queryByText('Borrar y volver a configurar')).not.toBeOnTheScreen();
    expect(view.getByText('No volvimos a configurar Mobile')).toBeOnTheScreen();
  });

  it('runs one deletion per confirmed press and asks for a fresh provider only after it completed', async () => {
    const deletion = createDeferredPort();
    const ports = createFakePorts({ deleteDatabase: jest.fn(() => deletion.promise) });
    const remountProvider = jest.fn();
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    const view = render(
      <RecoveryFallbackHarness cause={CORRUPTION_CAUSE} remountProvider={remountProvider} />,
    );

    await act(async () => {
      fireEvent.press(view.getByText('Volver a configurar Mobile'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Borrar y volver a configurar'));
    });

    expect(ports.deleteDatabase).toHaveBeenCalledTimes(1);
    expect(remountProvider).not.toHaveBeenCalled();
    // The destructive window reports itself and keeps no action that could start a second one.
    expect(view.getByText('Volviendo a configurar Mobile')).toBeOnTheScreen();
    expect(view.queryByText('Borrar y volver a configurar')).not.toBeOnTheScreen();
    expect(view.queryByText('Volver a configurar Mobile')).not.toBeOnTheScreen();

    await act(async () => {
      deletion.settle();
    });
    await act(async () => undefined);

    expect(ports.deleteDatabase).toHaveBeenCalledTimes(1);
    expect(remountProvider).toHaveBeenCalledTimes(1);
    expect(view.getByText('Mobile quedó como nueva')).toBeOnTheScreen();
  });

  it('explains a failed reset and offers the app settings as the warned last resort', async () => {
    const ports = createFakePorts({
      deleteDatabase: jest.fn(async () => {
        throw new Error('deletion is not available');
      }),
    });
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    createDatabaseResetAdaptersMock.mockReturnValue(ports);
    const view = render(<RecoveryFallbackHarness cause={CORRUPTION_CAUSE} />);

    await act(async () => {
      fireEvent.press(view.getByText('Volver a configurar Mobile'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Borrar y volver a configurar'));
    });
    await act(async () => undefined);

    expect(view.getByText('No pudimos volver a configurar Mobile')).toBeOnTheScreen();
    expect(view.getByText('Última opción')).toBeOnTheScreen();
    // Clearing the app storage destroys everything and clearing the cache repairs nothing, so the
    // copy has to say both or the last resort reads as a safe repair.
    expect(view.getByText(/elimina TODOS los datos y ajustes locales/)).toBeOnTheScreen();
    expect(view.getByText(/Borrar la caché no repara la base local/)).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(view.getByText('Abrir ajustes de la app'));
    });

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    expect(ports.deleteDatabase).toHaveBeenCalledTimes(1);
    openSettingsSpy.mockRestore();
  });

  it('offers the transient retry only when the caller can mount a fresh provider', () => {
    const remountProvider = jest.fn();
    const retryable = render(
      <RecoveryFallbackHarness cause={BUSY_CAUSE} remountProvider={remountProvider} />,
    );

    expect(retryable.getByText('La base local está ocupada')).toBeOnTheScreen();

    act(() => {
      fireEvent.press(retryable.getByText('Reintentar'));
    });

    expect(remountProvider).toHaveBeenCalledTimes(1);

    const notRetryable = render(<RecoveryFallbackHarness cause={BUSY_CAUSE} />);

    expect(notRetryable.getByText('La base local está ocupada')).toBeOnTheScreen();
    expect(notRetryable.queryByText('Reintentar')).not.toBeOnTheScreen();
  });
});
