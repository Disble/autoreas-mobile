/**
 * Tests for `plugins/withAndroidForegroundSync.js`: the config plugin that declares the
 * Notifee foreground-service type and the manifest-declared tick-alarm receiver.
 *
 * `expo/config-plugins` is mocked at the module boundary (the convention used in
 * `tests/features/sync/notifee-foreground-service-adapter.test.ts`): the real `withAndroidManifest`
 * only registers a mod for Expo's prebuild pipeline to run later, so calling the plugin directly in
 * a test would never invoke its callback. The mock makes `withAndroidManifest` invoke its callback
 * synchronously against a fake, already-parsed manifest instead, so the plugin's own logic — the
 * part this test exists to catch regressions in — runs unmodified.
 *
 * No `tests/plugins/` directory and no config-plugin test existed before this file. It is added
 * deliberately: "the plugin silently stopped applying" is the exact failure mode a CI manifest
 * guard exists to catch elsewhere in this feature, and catching it here, in Jest, is cheaper than
 * catching it in a published APK.
 */

import withAndroidForegroundSync from '../../plugins/withAndroidForegroundSync';

jest.mock('expo/config-plugins', () => ({
  AndroidConfig: {
    Manifest: {
      getMainApplicationOrThrow: jest.fn(
        (androidManifest: { manifest: { application: unknown[] } }) =>
          androidManifest.manifest.application[0],
      ),
    },
  },
  withAndroidManifest: jest.fn(
    (config: unknown, action: (configWithManifest: unknown) => unknown) => action(config),
  ),
}));

/** xml2js-shaped manifest element: `$` holds XML attributes, other keys hold nested arrays. */
interface ManifestElement {
  $?: Record<string, string>;
  'intent-filter'?: { action: { $: { 'android:name': string } }[] }[];
  property?: { $: Record<string, string> }[];
  receiver?: ManifestElement[];
  service?: ManifestElement[];
}

/** Minimal fake `AndroidManifest.xml`, parsed the same shape `expo/config-plugins` produces. */
interface FakeAndroidManifest {
  manifest: {
    'uses-permission': ManifestElement[];
    application: ManifestElement[];
  };
}

/** Minimal fake Expo config carrying the fake manifest as `modResults`. */
interface FakeExpoConfig {
  modResults: FakeAndroidManifest;
}

/** Full class name the plugin must declare; must match `TickAlarmReceiver.kt`'s package. */
const TICK_ALARM_RECEIVER_NAME = 'expo.modules.foregroundsyncticker.TickAlarmReceiver';

/** Broadcast action the plugin's intent-filter must declare; must match `TickAlarmScheduler.kt`. */
const TICK_ALARM_ACTION = 'expo.modules.foregroundsyncticker.TICK_ALARM';

/** Component name of the Notifee foreground service the plugin must keep declaring. */
const FOREGROUND_SERVICE_NAME = 'app.notifee.core.ForegroundService';

/**
 * Component name of the native Kotlin foreground service the plugin must declare (ODD
 * native-foreground-sync-service T3); must match `SyncForegroundService.SERVICE_CLASS_NAME` in
 * `modules/sync-engine/android`.
 */
const SYNC_FOREGROUND_SERVICE_NAME = 'expo.modules.syncengine.SyncForegroundService';

/** Builds a minimal fake parsed `AndroidManifest.xml`, with one bare `MainApplication` element. */
function createFakeConfig(): FakeExpoConfig {
  return {
    modResults: {
      manifest: {
        'uses-permission': [],
        application: [
          {
            $: { 'android:name': '.MainApplication' },
          },
        ],
      },
    },
  };
}

/** Reads back the (only) `<application>` element from a plugin result. */
function mainApplicationOf(config: FakeExpoConfig): ManifestElement {
  return config.modResults.manifest.application[0];
}

describe('withAndroidForegroundSync', () => {
  it('declares the receiver with the right name, exported=false, and the intent-filter action', () => {
    const config = createFakeConfig();

    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const receivers = mainApplicationOf(result).receiver;
    expect(receivers).toHaveLength(1);

    const receiver = receivers![0];
    expect(receiver.$?.['android:name']).toBe(TICK_ALARM_RECEIVER_NAME);
    expect(receiver.$?.['android:exported']).toBe('false');
    expect(receiver['intent-filter']).toEqual([
      { action: [{ $: { 'android:name': TICK_ALARM_ACTION } }] },
    ]);
  });

  it('is idempotent: running it twice does not duplicate the receiver', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const receivers = mainApplicationOf(result).receiver;
    expect(receivers).toHaveLength(1);
  });

  it('updates an existing receiver with that name instead of duplicating it', () => {
    const config = createFakeConfig();
    const mainApplication = mainApplicationOf(config);
    mainApplication.receiver = [
      {
        $: { 'android:name': TICK_ALARM_RECEIVER_NAME, 'android:exported': 'true' },
      },
    ];

    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const receivers = mainApplicationOf(result).receiver;
    expect(receivers).toHaveLength(1);
    expect(receivers![0].$?.['android:exported']).toBe('false');
    expect(receivers![0]['intent-filter']).toEqual([
      { action: [{ $: { 'android:name': TICK_ALARM_ACTION } }] },
    ]);
  });

  it('declares all six required permissions, including REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', () => {
    const config = createFakeConfig();

    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const permissionNames = result.modResults.manifest['uses-permission'].map(
      (permission) => permission.$?.['android:name'],
    );
    expect(permissionNames).toEqual([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'android.permission.WAKE_LOCK',
    ]);
  });

  it('preserves the foreground service and its specialUse subtype after adding the receiver', () => {
    const config = createFakeConfig();

    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    // The plugin now declares two services (Notifee's own, and ODD
    // native-foreground-sync-service T3's SyncForegroundService); this test only asserts on
    // Notifee's, which T3 must leave untouched (T5 decides its fate, not T3).
    const services = mainApplicationOf(result).service ?? [];
    const service = services.find(
      (candidate) => candidate.$?.['android:name'] === FOREGROUND_SERVICE_NAME,
    );
    expect(service).toBeDefined();
    expect(service!.$?.['android:name']).toBe(FOREGROUND_SERVICE_NAME);
    expect(service!.$?.['android:foregroundServiceType']).toBe('specialUse');
    expect(service!.property).toEqual([
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value':
            'continuous background synchronisation of local operations with the paired bridge device',
        },
      },
    ]);
  });

  it('declares the native SyncForegroundService with specialUse, exported=false, and the subtype property', () => {
    const config = createFakeConfig();

    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const services = mainApplicationOf(result).service ?? [];
    const syncService = services.find(
      (service) => service.$?.['android:name'] === SYNC_FOREGROUND_SERVICE_NAME,
    );

    expect(syncService).toBeDefined();
    expect(syncService!.$?.['android:exported']).toBe('false');
    expect(syncService!.$?.['android:foregroundServiceType']).toBe('specialUse');
    expect(syncService!.property).toEqual([
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value':
            'continuous background synchronisation of local operations with the paired bridge device',
        },
      },
    ]);

    // Both services must coexist: T5 decides Notifee's fate, T3 only adds the native one.
    expect(services).toHaveLength(2);
  });

  it('is idempotent for SyncForegroundService: running it twice does not duplicate it', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    const result = withAndroidForegroundSync(config) as unknown as FakeExpoConfig;

    const services = mainApplicationOf(result).service ?? [];
    const syncServices = services.filter(
      (service) => service.$?.['android:name'] === SYNC_FOREGROUND_SERVICE_NAME,
    );
    expect(syncServices).toHaveLength(1);
    expect(services).toHaveLength(2);
  });
});
