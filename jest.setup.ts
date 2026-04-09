// Shared Jest bootstrap for Expo 55 / React Native smoke tests.

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

jest.mock('heroui-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  const actual = jest.requireActual('heroui-native');

  /* eslint-disable react/display-name */
  // Simple passthrough wrapper that renders children in a View
  const wrap =
    (testID?: string) =>
    ({ children, className, ...props }: any) =>
      React.createElement(RN.View, { testID, ...props }, children);

  // Text-like wrapper
  const textWrap =
    (testID?: string) =>
    ({ children, className, ...props }: any) =>
      React.createElement(RN.Text, { testID, ...props }, children);

  // Pressable-like wrapper
  const pressableWrap =
    (testID?: string) =>
    ({ children, className, isDisabled, ...props }: any) =>
      React.createElement(
        RN.Pressable,
        { testID, disabled: isDisabled, ...props },
        children
      );
  /* eslint-enable react/display-name */

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

  // Compound Tabs
  const Tabs = Object.assign(wrap('heroui-tabs'), {
    List: wrap('heroui-tabs-list'),
    Trigger: pressableWrap('heroui-tabs-trigger'),
    Label: textWrap('heroui-tabs-label'),
    Indicator: wrap('heroui-tabs-indicator'),
    Content: wrap('heroui-tabs-content'),
  });

  // Compound TextField
  const TextField = wrap('heroui-text-field');

  // Compound Label
  const Label = Object.assign(wrap('heroui-label'), {
    Text: textWrap('heroui-label-text'),
  });

  // Input extends TextInput
  // eslint-disable-next-line react/display-name
  const Input = React.forwardRef((props: any, ref: any) =>
    React.createElement(RN.TextInput, { ref, ...props })
  );

  // Simple components
  const Spinner = () => React.createElement(RN.ActivityIndicator);
  const Separator = wrap('heroui-separator');
  const Skeleton = ({ children, isLoading, ...props }: any) =>
    React.createElement(RN.View, props, children);

  return {
    ...actual,
    Card,
    Button,
    Chip,
    Alert,
    Tabs,
    TextField,
    Label,
    Input,
    Spinner,
    Separator,
    Skeleton,
    // Keep real utilities
    cn: actual.cn,
    useThemeColor: (...args: any[]) => {
      if (Array.isArray(args[0])) return args[0].map(() => '#000000');
      return '#000000';
    },
    useToast: () => ({
      toast: { show: jest.fn(), hide: jest.fn() },
      isToastVisible: false,
    }),
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
