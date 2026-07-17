import * as SplashScreen from 'expo-splash-screen';

/** Prepares the native splash screen before the app root layout renders any React-controlled UI. */
function prepareAppRootLayoutSplashScreen() {
  SplashScreen.setOptions({
    duration: 300,
    fade: true,
  });

  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

prepareAppRootLayoutSplashScreen();
