// Shared Jest bootstrap for Expo 55 / React Native smoke tests.

import type { TextInput } from 'react-native';
import { installFocusedTestGuard } from './tests/setup/focused-test-guard.helpers';
import type { MockPrimitiveProps, MockSwitchProps } from './tests/setup/jest-setup.types';

installFocusedTestGuard();

jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');

  return {
    ...Reanimated,
    useReducedMotion: () => false,
    default: {
      ...Reanimated.default,
      call: () => undefined,
    },
  };
});

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');

  const useCameraPermissions = jest.fn(() => [
    {
      granted: true,
      canAskAgain: true,
    },
    jest.fn(async () => ({ granted: true, canAskAgain: true })),
  ]);

  const CameraView = ({ children, testID, ...props }: MockPrimitiveProps) =>
    React.createElement(RN.View, { testID: testID ?? 'setup-qr-camera', ...props }, children);

  return {
    CameraView,
    useCameraPermissions,
  };
});

jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('heroui-native');

  // Simple passthrough wrapper that renders children in a View.
  // Each factory names the component it returns so a failing render points at the primitive
  // instead of an anonymous frame -- these mocks stand in for the whole design system, so an
  // unnamed one turns every UI test failure into a hunt.
  const wrap = (testID?: string) => {
    const Wrapped = ({ children, className: _className, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.View, { testID, ...props }, children);
    Wrapped.displayName = testID ?? 'MockView';
    return Wrapped;
  };

  // Text-like wrapper
  const textWrap = (testID?: string) => {
    const WrappedText = ({ children, className: _className, ...props }: MockPrimitiveProps) =>
      React.createElement(RN.Text, { testID, ...props }, children);
    WrappedText.displayName = testID ?? 'MockText';
    return WrappedText;
  };

  // Pressable-like wrapper
  const pressableWrap = (testID?: string) => {
    const WrappedPressable = ({
      children,
      className: _className,
      isDisabled,
      ...props
    }: MockPrimitiveProps) =>
      React.createElement(
        RN.Pressable,
        { testID, disabled: isDisabled, ...props },
        children
      );
    WrappedPressable.displayName = testID ?? 'MockPressable';
    return WrappedPressable;
  };

  // Compound Card
  const Card = Object.assign(wrap('heroui-card'), {
    Body: wrap('heroui-card-body'),
    Header: wrap('heroui-card-header'),
    Footer: wrap('heroui-card-footer'),
    Title: textWrap('heroui-card-title'),
    Description: textWrap('heroui-card-description'),
  });

  // Compound Button
  const Button = Object.assign(pressableWrap('heroui-button'), {
    Label: textWrap('heroui-button-label'),
  });

  // Compound Chip
  const Chip = Object.assign(wrap('heroui-chip'), {
    Label: textWrap('heroui-chip-label'),
  });

  // Compound Alert
  const Alert = Object.assign(wrap('heroui-alert'), {
    Indicator: wrap('heroui-alert-indicator'),
    Content: wrap('heroui-alert-content'),
    Title: textWrap('heroui-alert-title'),
    Description: textWrap('heroui-alert-description'),
  });

  // Compound BottomSheet
  const BottomSheet = Object.assign(wrap('heroui-bottom-sheet'), {
    Trigger: pressableWrap('heroui-bottom-sheet-trigger'),
    Portal: wrap('heroui-bottom-sheet-portal'),
    Overlay: pressableWrap('heroui-bottom-sheet-overlay'),
    Content: wrap('heroui-bottom-sheet-content'),
    Close: pressableWrap('heroui-bottom-sheet-close'),
    Title: textWrap('heroui-bottom-sheet-title'),
    Description: textWrap('heroui-bottom-sheet-description'),
  });

  // Compound Tabs
  const Tabs = Object.assign(wrap('heroui-tabs'), {
    List: wrap('heroui-tabs-list'),
    Trigger: pressableWrap('heroui-tabs-trigger'),
    Label: textWrap('heroui-tabs-label'),
    Indicator: wrap('heroui-tabs-indicator'),
    Content: wrap('heroui-tabs-content'),
  });

  // Compound Switch. Unlike the other primitives this one MUST be mocked rather than passed
  // through: the real implementation reads `globalIsAllAnimationsDisabled` off the HeroUI
  // provider context, so rendering a screen containing one without wrapping every test in that
  // provider throws. The mock stays interactive -- it reports the TOGGLED value on press -- so
  // tests can still drive it with `fireEvent` and assert the handler contract.
  const SwitchRoot = ({
    children,
    className: _className,
    isDisabled,
    isSelected,
    onSelectedChange,
    ...props
  }: MockSwitchProps) =>
    React.createElement(
        RN.Pressable,
        {
          testID: 'heroui-switch',
          accessibilityRole: 'switch',
          accessibilityState: { checked: isSelected === true, disabled: isDisabled === true },
          disabled: isDisabled === true,
          onPress: () => onSelectedChange?.(isSelected !== true),
          ...props,
        },
        children
      );
  SwitchRoot.displayName = 'heroui-switch';

  const Switch = Object.assign(SwitchRoot, {
    Thumb: wrap('heroui-switch-thumb'),
    StartContent: wrap('heroui-switch-start-content'),
    EndContent: wrap('heroui-switch-end-content'),
  });

  // Compound TextField
  const TextField = wrap('heroui-text-field');

  // Compound Label
  const Label = Object.assign(wrap('heroui-label'), {
    Text: textWrap('heroui-label-text'),
  });

  // Input extends TextInput
  const InputRender = (props: MockPrimitiveProps, ref: React.Ref<TextInput>) =>
    React.createElement(RN.TextInput, { ref, ...props });
  InputRender.displayName = 'heroui-input';
  const Input = React.forwardRef<TextInput, MockPrimitiveProps>(InputRender);

  // Simple components
  const Spinner = () => React.createElement(RN.ActivityIndicator);
  Spinner.displayName = 'heroui-spinner';
  const Separator = wrap('heroui-separator');
  const Surface = wrap('heroui-surface');
  const Skeleton = ({ children, isLoading: _isLoading, ...props }: MockPrimitiveProps) =>
    React.createElement(RN.View, props, children);
  Skeleton.displayName = 'heroui-skeleton';

  return {
    ...actual,
    Card,
    Button,
    Chip,
    Alert,
    BottomSheet,
    Tabs,
    Switch,
    TextField,
    Label,
    Input,
    Spinner,
    Separator,
    Surface,
    Skeleton,
    // Keep real utilities
    cn: actual.cn,
    useThemeColor: (...args: unknown[]) => {
      if (Array.isArray(args[0])) return args[0].map(() => '#000000');
      return '#000000';
    },
    useToast: jest.fn(() => ({
      toast: { show: jest.fn(), hide: jest.fn() },
      isToastVisible: false,
    })),
    useBottomSheetAwareHandlers: jest.fn(() => ({
      onFocus: jest.fn(),
      onBlur: jest.fn(),
    })),
  };
});

jest.mock('uniwind', () => {
  const actual = jest.requireActual('uniwind');

  return {
    ...actual,
    useCSSVariable: (variables: string[]) =>
      variables.map((variable) => `mocked-${variable}`),
  };
});

jest.mock('react-native-notify-kit', () => {
  const AndroidForegroundServiceType = {
    FOREGROUND_SERVICE_TYPE_DATA_SYNC: 1,
  };
  const AuthorizationStatus = {
    DENIED: 0,
    AUTHORIZED: 1,
  };

  return {
    __esModule: true,
    default: {
      createChannel: jest.fn(async () => 'autoreas-sync-foreground'),
      displayNotification: jest.fn(async () => undefined),
      onBackgroundEvent: jest.fn(() => jest.fn()),
      registerForegroundService: jest.fn(),
      requestPermission: jest.fn(async () => ({ authorizationStatus: AuthorizationStatus.AUTHORIZED })),
      stopForegroundService: jest.fn(async () => undefined),
    },
    AndroidForegroundServiceType,
    AuthorizationStatus,
  };
});

jest.mock('react-native-worklets', () => {
  const identity = <T,>(value: T) => value;
  const runInline = <TArgs extends unknown[], TResult>(
    callback?: (...args: TArgs) => TResult
  ) => {
    return (...args: TArgs) => callback?.(...args);
  };

  return {
    __esModule: true,
    callMicrotasks: jest.fn(),
    createSerializable: identity,
    createSynchronizable: identity,
    createWorkletRuntime: jest.fn(),
    executeOnUIRuntimeSync: <TArgs extends unknown[], TResult>(
      callback?: (...args: TArgs) => TResult,
      ...args: TArgs
    ) => callback?.(...args),
    getDynamicFeatureFlag: jest.fn(),
    getRuntimeKind: () => 'ReactNative',
    getStaticFeatureFlag: jest.fn(),
    isSerializableRef: () => false,
    isSynchronizable: () => false,
    isWorkletFunction: () => true,
    makeShareable: identity,
    makeShareableCloneOnUIRecursive: identity,
    makeShareableCloneRecursive: identity,
    runOnJS: runInline,
    runOnRuntime: runInline,
    runOnUI: runInline,
    runOnUIAsync: async <TArgs extends unknown[], TResult>(
      callback?: (...args: TArgs) => TResult,
      ...args: TArgs
    ) => callback?.(...args),
    runOnUISync: <TArgs extends unknown[], TResult>(
      callback?: (...args: TArgs) => TResult,
      ...args: TArgs
    ) => callback?.(...args),
    RuntimeKind: {
      ReactNative: 'ReactNative',
      UI: 'UI',
    },
    scheduleOnRN: <TArgs extends unknown[]>(
      callback?: (...args: TArgs) => void,
      ...args: TArgs
    ) => callback?.(...args),
    scheduleOnRuntime: <TArgs extends unknown[]>(
      callback?: (...args: TArgs) => void,
      ...args: TArgs
    ) => callback?.(...args),
    scheduleOnUI: <TArgs extends unknown[]>(
      callback?: (...args: TArgs) => void,
      ...args: TArgs
    ) => callback?.(...args),
    serializableMappingCache: new Map(),
    setDynamicFeatureFlag: jest.fn(),
    unstable_eventLoopTask: <TArgs extends unknown[]>(
      callback?: (...args: TArgs) => void,
      ...args: TArgs
    ) => callback?.(...args),
    WorkletsModule: {},
  };
});

jest.mock('expo-crypto', () => {
  // A real v4-SHAPED UUID per call, derived from a counter rather than a PRNG: tests exercise
  // the shape the device produces AND stay reproducible, so a failure is the same failure on
  // a rerun. A constant would be worse than either -- it would hide a collision bug behind an
  // equality that always holds.
  let sequence = 0;

  return {
    randomUUID: jest.fn(() => {
      sequence += 1;
      const body = sequence.toString(16).padStart(12, '0');

      return `${body.slice(0, 8)}-${body.slice(8, 12)}-4000-8000-${body.padStart(12, '0')}`;
    }),
  };
});
