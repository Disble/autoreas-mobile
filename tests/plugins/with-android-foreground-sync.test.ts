/**
 * Tests for `plugins/withAndroidForegroundSync.js`: the config plugin that declares the Notifee
 * foreground-service type, the native sync components and the tick-alarm receiver, and that guards
 * the generated `MainApplication.onCreate` against booting React Native in a secondary process.
 *
 * `expo/config-plugins` is mocked at the module boundary (the convention used in
 * `tests/features/sync/native-foreground-sync-adapter.test.ts`): the real `withAndroidManifest` and
 * `withMainApplication` only register a mod for Expo's prebuild pipeline to run later, so calling the
 * plugin directly in a test would never invoke its callbacks. The mock makes both dispatchers invoke
 * their callback synchronously against a fake, already-parsed manifest and a fake `MainApplication`
 * source file, so the plugin's own logic — the part this test exists to catch regressions in — runs
 * unmodified. `CodeGenerator` and `AndroidConfig.CodeMod` stay REAL, because the idempotence this
 * plugin relies on is theirs: mocking them would let the test pass while the real prebuild duplicates
 * the generated blocks on every run.
 *
 * No `tests/plugins/` directory and no config-plugin test existed before this file. It is added
 * deliberately: "the plugin silently stopped applying" is the exact failure mode a CI manifest
 * guard exists to catch elsewhere in this feature, and catching it here, in Jest, is cheaper than
 * catching it in a published APK.
 */

import withAndroidForegroundSync from '../../plugins/withAndroidForegroundSync';

jest.mock('expo/config-plugins', () => {
  const actual = jest.requireActual('expo/config-plugins');

  return {
    AndroidConfig: {
      CodeMod: actual.AndroidConfig.CodeMod,
      Manifest: {
        getMainApplicationOrThrow: jest.fn(
          (androidManifest: { manifest: { application: unknown[] } }) =>
            androidManifest.manifest.application[0],
        ),
      },
    },
    CodeGenerator: actual.CodeGenerator,
    withAndroidManifest: jest.fn(
      (config: FakeExpoConfig, action: (configWithManifest: unknown) => unknown) =>
        action({ ...config, modResults: config.androidManifest }),
    ),
    withMainApplication: jest.fn(
      (config: FakeExpoConfig, action: (configWithMainApplication: unknown) => unknown) =>
        action({ ...config, modResults: config.mainApplication }),
    ),
  };
});

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

/** The `MainApplication` artifact a `mainApplication` mod receives, as the base mod reads it. */
interface FakeMainApplicationFile {
  path: string;
  language: 'java' | 'kt';
  contents: string;
}

/**
 * Minimal fake Expo config carrying both artifacts a mod can act on. The real pipeline hands each
 * mod its own `modResults`; here `androidManifest` and `mainApplication` are the two inputs the
 * mocked dispatchers project into `modResults`, and both keep living on the returned config so a
 * test can read the manifest and the guarded Kotlin source from the same object.
 */
interface FakeExpoConfig {
  androidManifest: FakeAndroidManifest;
  mainApplication: FakeMainApplicationFile;
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

/**
 * Component name of the AndroidX service that hosts the remote WorkManager floor; must match
 * `SyncFloorScheduler.kt`'s `RemoteWorkerService::class.java.name`.
 */
const REMOTE_WORKER_SERVICE_NAME = 'androidx.work.multiprocess.RemoteWorkerService';

/**
 * The private app process the native database owner runs in (ODD mobile-database-recovery T3); the
 * `:` prefix makes it private to this app's package.
 */
const SYNC_PROCESS_NAME = ':sync';

/** Tags the plugin passes to Expo's `mergeContents`, duplicated here to pin the generated markers. */
const MAIN_APPLICATION_GUARD_CALL_TAG = 'autoreas-sync-process-guard-call';
/** Tags the helper declaration `mergeContents` inserts, counted to prove it is declared once. */
const MAIN_APPLICATION_GUARD_HELPER_TAG = 'autoreas-sync-process-guard-helper';

/** The guard statement the plugin must insert into `onCreate`; counted to prove it is not duplicated. */
const MAIN_APPLICATION_GUARD_CALL = 'if (isSecondaryProcess()) {';

/** The guard's helper declaration; counted for the same reason as the call above. */
const MAIN_APPLICATION_GUARD_HELPER = 'private fun isSecondaryProcess(): Boolean {';

/**
 * Pristine `MainApplication.kt`, shaped like the file `expo prebuild` generates for this project:
 * the plugin anchors on `override fun onCreate()` and `super.onCreate()`, so the fixture is a
 * faithful (trimmed) copy of `android/app/src/main/java/com/disble/autoreasmobile/MainApplication.kt`
 * rather than an invented shape. The three statements the guard has to stay ahead of are all here,
 * in their template order.
 */
const PRISTINE_MAIN_APPLICATION = `package com.disble.autoreasmobile

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher

class MainApplication : Application(), ReactApplication {

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

/** Builds a minimal fake parsed `AndroidManifest.xml`, with one bare `MainApplication` element. */
function createFakeConfig(): FakeExpoConfig {
  return {
    androidManifest: {
      manifest: {
        'uses-permission': [],
        application: [
          {
            $: { 'android:name': '.MainApplication' },
          },
        ],
      },
    },
    mainApplication: {
      path: 'android/app/src/main/java/com/disble/autoreasmobile/MainApplication.kt',
      language: 'kt',
      contents: PRISTINE_MAIN_APPLICATION,
    },
  };
}

/** Reads back the (only) `<application>` element from a plugin result. */
function mainApplicationOf(config: FakeExpoConfig): ManifestElement {
  return config.androidManifest.manifest.application[0];
}

/** All declared `<service>` entries, by XML name, keyed for lookup instead of index guessing. */
function servicesByName(config: FakeExpoConfig): Record<string, ManifestElement | undefined> {
  const services = mainApplicationOf(config).service ?? [];
  return Object.fromEntries(services.map((service) => [service.$?.['android:name'], service]));
}

/** The guarded Kotlin source the `mainApplication` mod produced. */
function guardedKotlinOf(config: FakeExpoConfig): string {
  return config.mainApplication.contents;
}

/** Counts non-overlapping occurrences of `needle`, so a duplicated block is visible as `2`. */
function occurrencesOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** Extracts one `mergeContents`-generated block by its tag, asserting the block exists at all. */
function generatedBlockOf(source: string, tag: string): string {
  // The `- ` suffix on the begin marker matches `mergeContents`'s own header wording and keeps the
  // lookup exact: a tag that is a prefix of another tag can never be sliced the wrong block.
  const start = source.indexOf(`@generated begin ${tag} -`);
  const end = source.indexOf(`@generated end ${tag}`);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('withAndroidForegroundSync', () => {
  it('declares the receiver with the right name, exported=false, and the intent-filter action', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);

    const receivers = mainApplicationOf(config).receiver;
    expect(receivers).toHaveLength(1);

    const receiver = receivers![0];
    expect(receiver.$?.['android:name']).toBe(TICK_ALARM_RECEIVER_NAME);
    expect(receiver.$?.['android:exported']).toBe('false');
    expect(receiver['intent-filter']).toEqual([
      { action: [{ $: { 'android:name': TICK_ALARM_ACTION } }] },
    ]);

    // The receiver stays in the MAIN process on purpose: it re-arms the tick alarm from this app's
    // persisted ticking state, whose single writer is the main process.
    expect(receiver.$?.['android:process']).toBeUndefined();
  });

  it('is idempotent: running it twice does not duplicate the receiver', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    withAndroidForegroundSync(config);

    const receivers = mainApplicationOf(config).receiver;
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

    withAndroidForegroundSync(config);

    const receivers = mainApplicationOf(config).receiver;
    expect(receivers).toHaveLength(1);
    expect(receivers![0].$?.['android:exported']).toBe('false');
    expect(receivers![0]['intent-filter']).toEqual([
      { action: [{ $: { 'android:name': TICK_ALARM_ACTION } }] },
    ]);
  });

  it('declares all six required permissions, including REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);

    const permissionNames = config.androidManifest.manifest['uses-permission'].map(
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

    withAndroidForegroundSync(config);

    // The plugin now declares three services (Notifee's own, ODD
    // native-foreground-sync-service T3's SyncForegroundService, and ODD mobile-database-recovery
    // T3's RemoteWorkerService); this test only asserts on Notifee's, which T3 must leave untouched
    // (T5 decides its fate, not T3).
    const service = servicesByName(config)[FOREGROUND_SERVICE_NAME];
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

  it('declares the native SyncForegroundService in :sync, with specialUse, exported=false, and the subtype property', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);

    const services = mainApplicationOf(config).service ?? [];
    const syncService = servicesByName(config)[SYNC_FOREGROUND_SERVICE_NAME];

    expect(syncService).toBeDefined();
    expect(syncService!.$?.['android:exported']).toBe('false');
    expect(syncService!.$?.['android:foregroundServiceType']).toBe('specialUse');
    expect(syncService!.$?.['android:process']).toBe(SYNC_PROCESS_NAME);
    expect(syncService!.property).toEqual([
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value':
            'continuous background synchronisation of local operations with the paired bridge device',
        },
      },
    ]);

    // All three services must coexist: T5 decides Notifee's fate, T3 only adds the native ones.
    expect(services).toHaveLength(3);
  });

  it('is idempotent for SyncForegroundService: running it twice does not duplicate it', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    withAndroidForegroundSync(config);

    const services = mainApplicationOf(config).service ?? [];
    const syncServices = services.filter(
      (service) => service.$?.['android:name'] === SYNC_FOREGROUND_SERVICE_NAME,
    );
    expect(syncServices).toHaveLength(1);
    expect(services).toHaveLength(3);
  });

  it('declares androidx RemoteWorkerService with exported=false, in :sync, and no foreground type', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);

    const remoteWorkerService = servicesByName(config)[REMOTE_WORKER_SERVICE_NAME];

    expect(remoteWorkerService).toBeDefined();
    expect(remoteWorkerService!.$).toEqual({
      'android:name': REMOTE_WORKER_SERVICE_NAME,
      'android:exported': 'false',
      'android:process': SYNC_PROCESS_NAME,
    });
    // A plain bound service: WorkManager binds it off-process, so it must not claim a
    // foreground-service type (and the app must not need one for it).
    expect(remoteWorkerService!.$?.['android:foregroundServiceType']).toBeUndefined();
    expect(remoteWorkerService!.property).toBeUndefined();
  });

  it('merges into an existing RemoteWorkerService entry instead of duplicating or keeping a wrong process', () => {
    const config = createFakeConfig();
    mainApplicationOf(config).service = [
      {
        // A dependency that declared the service itself, exported and in the default process.
        $: { 'android:name': REMOTE_WORKER_SERVICE_NAME, 'android:exported': 'true' },
      },
    ];

    withAndroidForegroundSync(config);

    const services = mainApplicationOf(config).service ?? [];
    expect(services).toHaveLength(3);

    const remoteWorkerService = servicesByName(config)[REMOTE_WORKER_SERVICE_NAME];
    expect(remoteWorkerService!.$?.['android:exported']).toBe('false');
    expect(remoteWorkerService!.$?.['android:process']).toBe(SYNC_PROCESS_NAME);
  });

  it('leaves exactly one entry per service, each in the intended process, after two applications', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    withAndroidForegroundSync(config);

    const services = mainApplicationOf(config).service ?? [];
    const names = services.map((service) => service.$?.['android:name']);

    expect(services).toHaveLength(3);
    expect(new Set(names).size).toBe(3);

    // The two native app-database owners share `:sync`; Notifee's service keeps the main process.
    expect(servicesByName(config)[SYNC_FOREGROUND_SERVICE_NAME]!.$?.['android:process']).toBe(
      SYNC_PROCESS_NAME,
    );
    expect(servicesByName(config)[REMOTE_WORKER_SERVICE_NAME]!.$?.['android:process']).toBe(
      SYNC_PROCESS_NAME,
    );
    expect(servicesByName(config)[FOREGROUND_SERVICE_NAME]!.$?.['android:process']).toBeUndefined();
  });

  it('guards MainApplication.onCreate once, ahead of the React Native bootstrap, with a KDoc explaining :sync', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);

    const contents = guardedKotlinOf(config);

    expect(occurrencesOf(contents, MAIN_APPLICATION_GUARD_CALL)).toBe(1);
    expect(occurrencesOf(contents, MAIN_APPLICATION_GUARD_HELPER)).toBe(1);

    // The guard must run after `super.onCreate()` and before every statement that boots React
    // Native, and the template's own statements must keep their order in between.
    const superOnCreateAt = contents.indexOf('super.onCreate()');
    const guardCallAt = contents.indexOf(MAIN_APPLICATION_GUARD_CALL);
    const newArchitectureEntryPointAt = contents.indexOf(
      'DefaultNewArchitectureEntryPoint.releaseLevel',
    );
    const loadReactNativeAt = contents.indexOf('loadReactNative(this)');
    const onApplicationCreateAt = contents.indexOf(
      'ApplicationLifecycleDispatcher.onApplicationCreate(this)',
    );

    expect(superOnCreateAt).toBeGreaterThan(-1);
    expect(guardCallAt).toBeGreaterThan(superOnCreateAt);
    expect(newArchitectureEntryPointAt).toBeGreaterThan(guardCallAt);
    expect(loadReactNativeAt).toBeGreaterThan(newArchitectureEntryPointAt);
    expect(onApplicationCreateAt).toBeGreaterThan(loadReactNativeAt);

    // Both imports the generated helper needs; `Application.getProcessName()` alone would not be
    // enough on this app's minSdkVersion, so the /proc/self/cmdline fallback must be there too.
    expect(contents).toContain('import android.os.Build');
    expect(contents).toContain('import java.io.File');
    expect(contents).toContain('Build.VERSION.SDK_INT >= Build.VERSION_CODES.P');
    expect(contents).toContain('getProcessName()');
    expect(contents).toContain('File("/proc/self/cmdline")');
    expect(contents).toContain('catch (_: Throwable)');

    // The KDoc is the only place the reason for the split survives into the generated file, so its
    // presence and its statement of the process name are part of the contract.
    const helperBlock = generatedBlockOf(contents, MAIN_APPLICATION_GUARD_HELPER_TAG);
    expect(helperBlock).toMatch(
      /\/\*\*[\s\S]*?\*\/\n\s*private fun isSecondaryProcess\(\): Boolean \{/,
    );
    expect(helperBlock).toContain(SYNC_PROCESS_NAME);

    expect(
      generatedBlockOf(contents, MAIN_APPLICATION_GUARD_CALL_TAG).includes(
        MAIN_APPLICATION_GUARD_CALL,
      ),
    ).toBe(true);
  });

  it('does not duplicate the MainApplication guard when the mod runs over an already-guarded source', () => {
    const config = createFakeConfig();

    withAndroidForegroundSync(config);
    const firstPass = guardedKotlinOf(config);

    // Second prebuild over the file the first one generated: the mocked dispatcher hands the plugin
    // exactly that already-guarded source.
    withAndroidForegroundSync(config);
    const secondPass = guardedKotlinOf(config);

    expect(occurrencesOf(secondPass, MAIN_APPLICATION_GUARD_CALL)).toBe(1);
    expect(occurrencesOf(secondPass, MAIN_APPLICATION_GUARD_HELPER)).toBe(1);
    expect(occurrencesOf(secondPass, '@generated begin')).toBe(2);
    // Byte-identical, not merely "still one guard": a prebuild over an existing `android/` must
    // leave the generated sources untouched.
    expect(secondPass).toBe(firstPass);
  });

  it('refuses a non-Kotlin MainApplication instead of silently leaving it unguarded', () => {
    const config = createFakeConfig();
    config.mainApplication.language = 'java';

    expect(() => withAndroidForegroundSync(config)).toThrow(/expected a Kotlin MainApplication/);
    expect(guardedKotlinOf(config)).toBe(PRISTINE_MAIN_APPLICATION);
  });
});
