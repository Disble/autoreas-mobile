import { fireEvent, render } from '@testing-library/react-native';
import { type ReactNode } from 'react';
import { BatteryExemptionPrompt } from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/BatteryExemptionPrompt';
import { BATTERY_EXEMPTION_PROMPT_COPY } from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/battery-exemption-prompt.constants';
import { useBatteryExemptionPrompt } from '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/use-battery-exemption-prompt';

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

jest.mock(
  '../../../../src/features/battery-exemption/ui/BatteryExemptionPrompt/use-battery-exemption-prompt',
  () => ({ useBatteryExemptionPrompt: jest.fn() }),
);

/**
 * `Dialog` is reproduced rather than passed through: the real one renders through a portal that
 * only exists inside the library provider. The mock keeps the two behaviors its contract defines:
 * a closed dialog renders nothing, and closing it by any route reports `onOpenChange(false)`.
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
    // Keeps `className` so the width constraint that stops the dialog spanning a tablet is visible.
    Content: ({ children, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.View, { testID: 'dialog-content', ...props }, children),
    Overlay: view('dialog-overlay'),
    Description: text('dialog-description'),
    Portal: ({ children }: MockPrimitiveProps) => children,
    Title: text('dialog-title'),
  });

  return {
    ...actual,
    Button: Object.assign(pressable('button'), { Label: text('button-label') }),
    Dialog,
    cn: (...classNames: string[]) => classNames.filter(Boolean).join(' '),
  };
});

/** Records the allow answer the dialog reports. */
const handleAllow = jest.fn();
/** Records the dismiss answer the dialog reports. */
const handleDismiss = jest.fn();

/** Points the mocked hook at one dialog state. */
function mockHook(isOpen: boolean, variant: 'prompt' | 'reminder' | null) {
  (useBatteryExemptionPrompt as jest.Mock).mockReturnValue({
    isOpen,
    copy: variant ? BATTERY_EXEMPTION_PROMPT_COPY[variant] : null,
    handleAllow,
    handleDismiss,
  });
}

describe('BatteryExemptionPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing while no dialog is due', () => {
    mockHook(false, null);

    const view = render(<BatteryExemptionPrompt />);

    expect(view.queryByTestId('dialog')).toBeNull();
  });

  it('renders the first prompt copy and reports both answers', () => {
    mockHook(true, 'prompt');

    const view = render(<BatteryExemptionPrompt />);

    expect(view.getByText('Mantén la sincronización activa')).toBeOnTheScreen();
    fireEvent.press(view.getByText('Permitir'));
    fireEvent.press(view.getByText('Ahora no'));

    expect(handleAllow).toHaveBeenCalledTimes(1);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the reminder copy with its close action', () => {
    mockHook(true, 'reminder');

    const view = render(<BatteryExemptionPrompt />);

    expect(view.getByText('La sincronización en segundo plano se detuvo')).toBeOnTheScreen();
    expect(view.getByText(/desde Ajustes/)).toBeOnTheScreen();
    fireEvent.press(view.getByText('Cerrar'));

    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('treats the close control as a dismissal', () => {
    mockHook(true, 'prompt');

    const view = render(<BatteryExemptionPrompt />);
    fireEvent.press(view.getByTestId('dialog-close'));

    expect(handleDismiss).toHaveBeenCalledTimes(1);
    expect(handleAllow).not.toHaveBeenCalled();
  });

  it('dims the screen behind the dialog and keeps it at a readable width', () => {
    mockHook(true, 'prompt');

    const view = render(<BatteryExemptionPrompt />);

    expect(view.getByTestId('dialog-overlay')).toBeOnTheScreen();
    expect(view.getByTestId('dialog-content').props.className).toMatch(/(^| )max-w-/);
  });
});
