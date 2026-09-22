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
//
// The attribute cannot ship alone. `lintVitalRelease` runs inside every release build and fails on
// `HardcodedDebugMode` ("Avoid hardcoding the debug mode"), which is exactly what a lab build does
// on purpose. So the same gate that adds the attribute also adds lint's own per-element
// suppression, `tools:ignore`. Learned the expensive way: the first lab build died in
// `lintVitalRelease` after eleven minutes with that single error.

/** The exact env value the `lab` profile in eas.json sets; anything else leaves the manifest alone. */
const LAB_BUILD_FLAG = '1';

/** The manifest attribute this plugin adds, and only when the lab flag is set. */
const DEBUGGABLE_ATTRIBUTE = 'android:debuggable';

/** The namespace the suppression attribute below needs on the manifest root. */
const TOOLS_NAMESPACE_ATTRIBUTE = 'xmlns:tools';

/** Lint's own suppression attribute, scoped to the element that carries it. */
const LINT_IGNORE_ATTRIBUTE = 'tools:ignore';

/** The one lint check silenced, per element, and only for a lab build. */
const HARDCODED_DEBUG_MODE_CHECK = 'HardcodedDebugMode';

/** Declares the `tools` namespace on the manifest root when it is missing. */
function ensureToolsNamespace(androidManifest) {
  const manifestRoot = androidManifest.manifest;

  if (manifestRoot.$?.[TOOLS_NAMESPACE_ATTRIBUTE]) {
    return;
  }

  manifestRoot.$ = {
    ...manifestRoot.$,
    [TOOLS_NAMESPACE_ATTRIBUTE]: 'http://schemas.android.com/tools',
  };
}

/** Adds the debuggable flag and its lint suppression to `<application>`, idempotently. */
function ensureDebuggableApplication(mainApplication) {
  mainApplication.$ = {
    ...mainApplication.$,
    [DEBUGGABLE_ATTRIBUTE]: 'true',
    [LINT_IGNORE_ATTRIBUTE]: HARDCODED_DEBUG_MODE_CHECK,
  };
}

module.exports = function withAndroidLabDebuggable(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    if (process.env.AUTOREAS_LAB_BUILD !== LAB_BUILD_FLAG) {
      // Not a lab build: the manifest must not carry the attribute at all, not even as `false`,
      // and it must not carry the suppression either -- a release build has nothing to silence.
      return configWithManifest;
    }

    const androidManifest = configWithManifest.modResults;
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

    ensureToolsNamespace(androidManifest);
    ensureDebuggableApplication(mainApplication);

    return configWithManifest;
  });
};
