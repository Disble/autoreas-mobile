const {
  AndroidConfig,
  withAndroidManifest,
} = require('expo/config-plugins');

// react-native-notify-kit keeps the original Notifee service class name but, unlike Notifee 9.x,
// no longer hardcodes android:foregroundServiceType in its own manifest. This plugin is therefore
// the only source of that attribute, and Android 14+ refuses to start a foreground service without
// it. `tools:replace` is retained deliberately: it is a no-op while nothing else declares the
// attribute, and it keeps the app manifest authoritative if a future dependency does.
const FOREGROUND_SERVICE_NAME = 'app.notifee.core.ForegroundService';
const FOREGROUND_SERVICE_TYPE = 'dataSync';
const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];

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
