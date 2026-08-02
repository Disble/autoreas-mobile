jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: jest.fn(({ children }) => children),
  KeyboardAvoidingView: jest.fn(({ children }) => children),
  KeyboardController: { setInputMode: jest.fn() },
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => undefined),
  setOptions: jest.fn(),
}));

jest.mock('../../../../global.css', () => ({}), { virtual: true });

jest.mock('../../../../src/features/startup', () => ({
  StartupBoundary: jest.fn(() => null),
}));

describe('StartupBoundary splash preparation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('prevents splash auto-hide before the root layout exports render', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SplashScreen = require('expo-splash-screen');

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../../src/app/_layout');

      expect(SplashScreen.setOptions).toHaveBeenCalledWith({
        duration: 300,
        fade: true,
      });
      expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
    });
  });
});
