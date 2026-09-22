/** Expo config-plugin helpers used to edit the generated Android manifest. */
const {
  AndroidConfig,
  withAndroidManifest,
} = require('expo/config-plugins');

// react-native-notify-kit keeps the original Notifee service class name but, unlike Notifee 9.x,
// no longer hardcodes android:foregroundServiceType in its own manifest. This plugin is therefore
// the only source of that attribute, and Android 14+ refuses to start a foreground service without
// it. `tools:replace` is retained deliberately: it is a no-op while nothing else declares the
// attribute, and it keeps the app manifest authoritative if a future dependency does.
//
// The type is `specialUse` instead of `dataSync` because Android 15 caps `dataSync` and
// `mediaProcessing` foreground services at 6 hours per 24 for apps targeting SDK 35+, after which
// `Service.onTimeout()` fires and the system refuses to start another one until the app is brought
// to the foreground. `specialUse` is the documented escape for services that fit no other type; it
// requires the `android.permission.FOREGROUND_SERVICE_SPECIAL_USE` permission and a
// `android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property child on the service element. The Play
// Console declaration for `specialUse` applies only when submitting to Google Play; this app ships
// sideloaded APKs.
/** Android component name of the Notifee foreground service this plugin owns. */
const FOREGROUND_SERVICE_NAME = 'app.notifee.core.ForegroundService';

/** The declared foreground-service type: `specialUse`, outside Android 15's capped `dataSync` list. */
const FOREGROUND_SERVICE_TYPE = 'specialUse';

/** The subtype property Android requires on a service that declares the `specialUse` type. */
const SPECIAL_USE_FGS_SUBTYPE_PROPERTY = {
  $: {
    'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
    'android:value':
      'continuous background synchronisation of local operations with the paired bridge device',
  },
};

// REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is exemption #13 on Android's documented background-FGS-
// start allow-list, and the only one this sideloaded app can reach (the others need a system
// role, a carrier privilege, or a Play-only allow-list entry). Without it, `getFgsAllowStart`
// stays `DENIED` on targetSdk 35 and nothing -- not a manifest receiver, not a watchdog -- can
// restart the foreground service from the background; the declaration only unlocks the request,
// the user still grants or refuses it through the system dialog fired by
// `requestIgnoreBatteryOptimizations()` in `ForegroundSyncTickerModule.kt`.
/** Permissions the service needs, merged into the manifest when it does not declare them yet. */
const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  // Kept until the merged manifest proves no other component still needs it.
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.WAKE_LOCK',
];

/** Adds one `uses-permission` entry unless the manifest already declares it. */
function ensureUsesPermission(androidManifest, permissionName) {
  const permissions = androidManifest.manifest['uses-permission'] ?? [];
  const alreadyExists = permissions.some(
    (permission) => permission.$?.['android:name'] === permissionName,
  );

  if (!alreadyExists) {
    permissions.push({
      $: { 'android:name': permissionName },
    });
  }

  androidManifest.manifest['uses-permission'] = permissions;
}

/** Adds the `specialUse` subtype property to the service unless it is already present. */
function ensureSpecialUseSubtypeProperty(service) {
  const properties = service.property ?? [];
  const alreadyExists = properties.some(
    (property) => property.$?.['android:name'] === SPECIAL_USE_FGS_SUBTYPE_PROPERTY.$['android:name'],
  );

  if (!alreadyExists) {
    properties.push(SPECIAL_USE_FGS_SUBTYPE_PROPERTY);
  }

  service.property = properties;
}

/** Points the Notifee service at the declared type, creating the service element when absent. */
function ensureForegroundService(mainApplication) {
  const services = mainApplication.service ?? [];
  const existingService = services.find(
    (service) => service.$?.['android:name'] === FOREGROUND_SERVICE_NAME,
  );

  if (existingService) {
    existingService.$ = {
      ...existingService.$,
      'android:foregroundServiceType': FOREGROUND_SERVICE_TYPE,
      'tools:replace': 'android:foregroundServiceType',
    };
  } else {
    services.push({
      $: {
        'android:name': FOREGROUND_SERVICE_NAME,
        'android:foregroundServiceType': FOREGROUND_SERVICE_TYPE,
        'tools:replace': 'android:foregroundServiceType',
      },
    });
  }

  services.forEach((service) => {
    if (service.$?.['android:name'] === FOREGROUND_SERVICE_NAME) {
      ensureSpecialUseSubtypeProperty(service);
    }
  });

  mainApplication.service = services;
}

module.exports = function withAndroidForegroundSync(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const androidManifest = configWithManifest.modResults;
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

    REQUIRED_PERMISSIONS.forEach((permissionName) => {
      ensureUsesPermission(androidManifest, permissionName);
    });

    ensureForegroundService(mainApplication);

    return configWithManifest;
  });
};
