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
