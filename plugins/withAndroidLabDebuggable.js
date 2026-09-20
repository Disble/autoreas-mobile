/** Expo config-plugin helpers used to edit the generated Android manifest. */
const {
  AndroidConfig,
  withAndroidManifest,
} = require('expo/config-plugins');

// A lab APK must be inspectable from outside the app (`adb shell run-as`), and that only works
// while the application element carries `android:debuggable="true"`. A release APK must NEVER be
// debuggable: the flag widens the attack surface and `run-as` itself is the inspection channel we
// deny release builds on purpose. The gate is therefore driven by `AUTOREAS_LAB_BUILD`, a variable
// only the `lab` profile in eas.json defines -- neither `production` nor a bare `npx expo prebuild`
// sets it, so the manifest is left untouched unless the lab build asked for it explicitly.

/** The exact env value the `lab` profile in eas.json sets; anything else leaves the manifest alone. */
const LAB_BUILD_FLAG = '1';

/** The manifest attribute this plugin adds, and only when the lab flag is set. */
const DEBUGGABLE_ATTRIBUTE = 'android:debuggable';

/** Adds `android:debuggable="true"` to the `<application>` element unless it already declares it. */
function ensureDebuggableApplication(mainApplication) {
  if (mainApplication.$?.[DEBUGGABLE_ATTRIBUTE] === 'true') {
    return;
  }

  mainApplication.$ = {
    ...mainApplication.$,
    [DEBUGGABLE_ATTRIBUTE]: 'true',
  };
}

module.exports = function withAndroidLabDebuggable(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    if (process.env.AUTOREAS_LAB_BUILD !== LAB_BUILD_FLAG) {
      // Not a lab build: the manifest must not carry the attribute at all, not even as `false`.
      return configWithManifest;
    }

    const androidManifest = configWithManifest.modResults;
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

    ensureDebuggableApplication(mainApplication);

    return configWithManifest;
  });
};
