/** Expo config-plugin helpers used to edit the generated Android manifest and MainApplication. */
const {
  AndroidConfig,
  CodeGenerator,
  withAndroidManifest,
  withMainApplication,
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

// The tick alarm used to be delivered to a receiver registered on the React Native context at
// runtime, which dies with that context while the alarm itself keeps living in the system
// AlarmManager -- it then fires into a void (the `sent=0` defect this receiver fixes). A
// manifest-declared receiver survives process death, because Android (not the RN bridge) owns
// its lifecycle. No local Expo module in this repo keeps a non-empty AndroidManifest.xml --
// `foreground-sync-ticker`, `sync-engine` and `sync-journal` all leave app-level manifest wiring
// to this plugin -- so the receiver is declared here, following that convention, rather than in
// `modules/foreground-sync-ticker/android/src/main/AndroidManifest.xml`.
/** Full class name of the manifest-declared receiver that re-arms the tick alarm. */
const TICK_ALARM_RECEIVER_NAME = 'expo.modules.foregroundsyncticker.TickAlarmReceiver';

// ODD native-foreground-sync-service T3: the Kotlin-owned service that runs one native sync
// attempt per start command. A JS config plugin and Kotlin native code cannot import each
// other's constants, so this string is the cross-module contract -- it must match
// SyncForegroundService.SERVICE_CLASS_NAME in modules/sync-engine/android exactly.
/** Full class name of the native foreground service that runs the sync attempt. */
const SYNC_FOREGROUND_SERVICE_NAME = 'expo.modules.syncengine.SyncForegroundService';

// ODD mobile-database-recovery T3: the app's own native database owner -- the Kotlin sync service
// and the WorkManager floor -- must live in its own Android process, `:sync`, so the Android
// framework's SQLite never shares a process with Expo's vendored `exsqlite3_*` core that JS uses.
// Two independently linked SQLite cores opening `autoreas.db` in one process is the corruption
// hazard this task removes, and a process name is the only lever that separates them. These
// declarations live in this plugin because `expo prebuild` GENERATES `android/` from it (`android/`
// is excluded from git): a hand-edit in `android/` would not survive the next prebuild.
/**
 * Android process every native app-database owner runs in. The `:` prefix makes the name private to
 * this app's package, so the process can never collide with another installed app's process.
 */
const SYNC_PROCESS_NAME = ':sync';

// AndroidX's `RemoteCoroutineWorker` runs `doRemoteWork()` in the process that hosts a BOUND
// `RemoteWorkerService`, resolved from the work request's own `ARGUMENT_CLASS_NAME` -- see
// SyncFloorScheduler.kt, the Kotlin half of this contract, which stamps
// `RemoteWorkerService::class.java.name` into the request. The `androidx.work:work-multiprocess` AAR
// ships a manifest that declares only `RemoteWorkManagerService`, so the worker service the floor
// actually binds to has to be declared by the app, here.
/** Full class name of the AndroidX service that hosts the remote WorkManager floor. */
const REMOTE_WORKER_SERVICE_NAME = 'androidx.work.multiprocess.RemoteWorkerService';

// Must match TICK_ALARM_ACTION in TickAlarmScheduler.kt exactly -- the two are not shared
// through any single source of truth, since a JS config plugin and Kotlin native code cannot
// import each other's constants.
/** Broadcast action the receiver's intent-filter listens for. */
const TICK_ALARM_ACTION = 'expo.modules.foregroundsyncticker.TICK_ALARM';

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

/**
 * Declares our own native foreground service (ODD native-foreground-sync-service T3),
 * idempotently -- same shape as {@link ensureForegroundService} above, but `exported` stays
 * `false` (this component is only ever started by this app's own receiver or module, through an
 * explicit intent naming {@link SYNC_FOREGROUND_SERVICE_NAME}) and no `tools:replace` is needed,
 * since nothing else in the merged manifest declares this component.
 *
 * `android:process` is the whole point of the declaration in ODD mobile-database-recovery T3: this
 * service opens `autoreas.db` through the framework's SQLite, so it must not run in the process
 * that hosts Expo's own SQLite core (see {@link SYNC_PROCESS_NAME}).
 */
function ensureSyncForegroundService(mainApplication) {
  const services = mainApplication.service ?? [];
  const existingService = services.find(
    (service) => service.$?.['android:name'] === SYNC_FOREGROUND_SERVICE_NAME,
  );

  const serviceAttributes = {
    'android:name': SYNC_FOREGROUND_SERVICE_NAME,
    'android:exported': 'false',
    'android:foregroundServiceType': FOREGROUND_SERVICE_TYPE,
    'android:process': SYNC_PROCESS_NAME,
  };

  if (existingService) {
    existingService.$ = { ...existingService.$, ...serviceAttributes };
    ensureSpecialUseSubtypeProperty(existingService);
  } else {
    const newService = { $: serviceAttributes };
    ensureSpecialUseSubtypeProperty(newService);
    services.push(newService);
  }

  mainApplication.service = services;
}

/**
 * Declares the AndroidX service that hosts the remote WorkManager floor, idempotently and in the
 * same mutate-in-place shape as {@link ensureSyncForegroundService} above (create when absent, merge
 * the attributes when present, never duplicate).
 *
 * `android:process` is again the entire point: it decides which process
 * `SyncFloorWorker.doRemoteWork` runs in, and therefore which process opens `autoreas.db` on a floor
 * tick. `exported` stays `false` -- the service's only client is WorkManager inside this app -- and
 * no `foregroundServiceType` or subtype property applies here, because this component is a plain
 * bound service, not a foreground service.
 */
function ensureRemoteWorkerService(mainApplication) {
  const services = mainApplication.service ?? [];
  const existingService = services.find(
    (service) => service.$?.['android:name'] === REMOTE_WORKER_SERVICE_NAME,
  );

  const serviceAttributes = {
    'android:name': REMOTE_WORKER_SERVICE_NAME,
    'android:exported': 'false',
    'android:process': SYNC_PROCESS_NAME,
  };

  if (existingService) {
    existingService.$ = { ...existingService.$, ...serviceAttributes };
  } else {
    services.push({ $: serviceAttributes });
  }

  mainApplication.service = services;
}

/**
 * Declares the manifest receiver that re-arms the tick alarm, creating or updating it
 * idempotently -- mirroring how {@link ensureForegroundService} treats the Notifee service, and
 * how {@link ensureSpecialUseSubtypeProperty} treats that service's subtype property. `exported`
 * stays `false`: the receiver is woken only by this app's own `PendingIntent`, and nothing else
 * should be able to fire it.
 *
 * This receiver deliberately keeps the MAIN process: its re-arm decision reads this app's persisted
 * ticking state, whose single writer stays in the main process. Moving it into {@link
 * SYNC_PROCESS_NAME} would give that state a second process to read from -- the stale-flag defect
 * ODD mobile-database-recovery T3 slice A fixed for the floor -- for no benefit, since the receiver
 * opens no database at all.
 */
function ensureReceiver(mainApplication) {
  const receivers = mainApplication.receiver ?? [];
  const existingReceiver = receivers.find(
    (receiver) => receiver.$?.['android:name'] === TICK_ALARM_RECEIVER_NAME,
  );

  const receiverAttributes = {
    'android:name': TICK_ALARM_RECEIVER_NAME,
    'android:exported': 'false',
  };

  const intentFilter = {
    action: [{ $: { 'android:name': TICK_ALARM_ACTION } }],
  };

  if (existingReceiver) {
    existingReceiver.$ = {
      ...existingReceiver.$,
      ...receiverAttributes,
    };
    existingReceiver['intent-filter'] = [intentFilter];
  } else {
    receivers.push({
      $: receiverAttributes,
      'intent-filter': [intentFilter],
    });
  }

  mainApplication.receiver = receivers;
}

// Expo's own code-editing helper (`CodeGenerator.mergeContents`) is idempotent BY TAG: it inserts a
// generated block only when a header carrying this tag AND the exact content hash is absent, so
// re-running this mod -- the normal case, since prebuild runs on every build -- can neither
// duplicate nor nest the guard. Two tags are used so the guard call and its helper method stay
// independently replaceable when either one changes. The two tags share no prefix relation, so
// `mergeContents` can never mistake one block's end marker for the other's.
/** Tag `mergeContents` stamps on the generated `MainApplication.onCreate` process guard. */
const MAIN_APPLICATION_GUARD_CALL_TAG = 'autoreas-sync-process-guard-call';

/** Separate tag for the guard's helper method, kept apart from the call site's own generated block. */
const MAIN_APPLICATION_GUARD_HELPER_TAG = 'autoreas-sync-process-guard-helper';

// The guard is Kotlin, indented for `MainApplication`'s class body (2 spaces) and for the top of
// `onCreate` (4 spaces). Both blocks are inserted by tag, so their text can evolve freely: the next
// prebuild replaces a tag whose content hash changed. The `\u0000` below is escaped for JavaScript
// so the GENERATED Kotlin is the two-character escape sequence Kotlin's own string literal needs.
/** The one statement the guard inserts into the generated `MainApplication.onCreate`. */
const MAIN_APPLICATION_GUARD_CALL_SOURCE = `    if (isSecondaryProcess()) {
      return
    }`;

/**
 * KDoc plus body of the `isSecondaryProcess()` helper the guard calls. The KDoc is the only place
 * the reason for the split survives into the generated (and git-ignored) `MainApplication.kt`.
 */
const MAIN_APPLICATION_GUARD_HELPER_SOURCE = `  /**
   * ODD mobile-database-recovery T3 -- why this app's native database owner runs in \`:sync\`:
   * Android instantiates this class in EVERY process of the app, and the native owner
   * (\`SyncForegroundService\` and the AndroidX \`RemoteWorkerService\` that hosts the WorkManager
   * floor) is declared with \`android:process=":sync"\` so the framework SQLite it uses never
   * shares a process with the Expo SQLite core that opens the same \`autoreas.db\` from JS. React
   * Native has to stay out of \`:sync\` for that split to be real: without this guard that process
   * would boot its own SoLoader, Hermes runtime and JS bundle -- a second React Native instance
   * nothing ever tears down -- for a process that only ever runs native sync code.
   *
   * Answers \`false\` when the current process cannot be named, an unreadable
   * \`/proc/self/cmdline\` for example. Failing towards the main process is deliberate: booting
   * React Native where it is not needed costs memory, while skipping this application's own startup
   * in the main process would break the app.
   */
  private fun isSecondaryProcess(): Boolean {
    val currentProcessName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Application.getProcessName() only exists from API 28, and minSdkVersion here is lower.
      getProcessName()
    } else {
      // Before API 28 the kernel-exposed command line is the only way to name this process. It is
      // read defensively: any failure must degrade to "assume the main process" rather than throw
      // out of Application.onCreate.
      try {
        File("/proc/self/cmdline").readText().substringBefore('\\u0000')
      } catch (_: Throwable) {
        null
      }
    }

    return currentProcessName != null &&
      currentProcessName.isNotEmpty() &&
      currentProcessName != packageName
  }`;

/**
 * Guards the generated `MainApplication.onCreate` so a secondary process does not boot React
 * Native (ODD mobile-database-recovery T3). Android runs
 * `expo.modules.ApplicationLifecycleDispatcher.onApplicationCreate`, `loadReactNative` and
 * `DefaultNewArchitectureEntryPoint` exactly as this template calls them, and the `:sync` process
 * that hosts the native database owner must run neither -- see the generated KDoc on
 * `isSecondaryProcess` for the full reason. The early return is inserted immediately after
 * `super.onCreate()`, ahead of every one of those three calls, and the template's own statements
 * keep their text and their order.
 *
 * The edited file is Kotlin because that is what `expo prebuild` generates for this project; a
 * non-Kotlin `MainApplication` is an unexpected project state, and a silent skip there would ship
 * an app that boots a second React Native runtime in `:sync`, so this mod refuses instead.
 */
function withMainApplicationProcessGuard(config) {
  return withMainApplication(config, (configWithMainApplication) => {
    const { modResults } = configWithMainApplication;

    if (modResults.language !== 'kt') {
      throw new Error(
        `withAndroidForegroundSync: expected a Kotlin MainApplication to guard, but ${modResults.path} is ${modResults.language}.`,
      );
    }

    // `addImports` is already idempotent (it skips an import the source contains), so a second run
    // over an already-modded file adds nothing.
    const withImports = AndroidConfig.CodeMod.addImports(
      modResults.contents,
      ['android.os.Build', 'java.io.File'],
      false,
    );

    const withHelper = CodeGenerator.mergeContents({
      src: withImports,
      comment: '  //',
      tag: MAIN_APPLICATION_GUARD_HELPER_TAG,
      // Behind `override fun onCreate()`: the class-body anchor Kotlin resolves for the mod.
      offset: 0,
      anchor: /override fun onCreate\(\)/,
      newSrc: MAIN_APPLICATION_GUARD_HELPER_SOURCE,
    });

    const withGuardCall = CodeGenerator.mergeContents({
      src: withHelper.contents,
      comment: '    //',
      // After `super.onCreate()` and before the template's first statement, which is what keeps the
      // guard ahead of DefaultNewArchitectureEntryPoint / loadReactNative / onApplicationCreate.
      offset: 1,
      anchor: /super\.onCreate\(\)/,
      tag: MAIN_APPLICATION_GUARD_CALL_TAG,
      newSrc: MAIN_APPLICATION_GUARD_CALL_SOURCE,
    });

    modResults.contents = withGuardCall.contents;

    return configWithMainApplication;
  });
}

module.exports = function withAndroidForegroundSync(config) {
  const configWithManifest = withAndroidManifest(config, (configWithManifestAction) => {
    const androidManifest = configWithManifestAction.modResults;
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

    REQUIRED_PERMISSIONS.forEach((permissionName) => {
      ensureUsesPermission(androidManifest, permissionName);
    });

    ensureForegroundService(mainApplication);
    ensureSyncForegroundService(mainApplication);
    ensureRemoteWorkerService(mainApplication);
    ensureReceiver(mainApplication);

    return configWithManifestAction;
  });

  return withMainApplicationProcessGuard(configWithManifest);
};
