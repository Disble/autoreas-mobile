import { NATIVE_BACKGROUND_FLOOR_MODULE_NAME } from "./native-background-floor.constants";
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from "../native-module-loader/native-module-loader.helpers";
import type {
  SyncExecutionStatus,
  SyncExecutionStrategy,
} from "../sync-execution-strategy.types";
import type { SyncRuntimeRegistrationStatus } from "../sync-runtime-status.types";
import type {
  CreateNativeBackgroundFloorStrategyParams,
  NativeBackgroundFloorModule,
  NativeBackgroundFloorStatusMap,
} from "./native-background-floor.types";

/** The floor status after normalization: the closed registration vocabulary plus the flag the snapshot stores. */
interface NativeBackgroundFloorStatus {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly isBackgroundTaskRegistered: boolean;
}

/**
 * True when [value] is a member of the closed `SyncRuntimeRegistrationStatus` vocabulary.
 * `unsupported` is a LEGITIMATE native answer here (the Kotlin module resolves it when no React
 * context or no WorkManager can answer), so it is accepted alongside the two lifecycle values.
 */
function isRegistrationStatus(
  value: unknown,
): value is SyncRuntimeRegistrationStatus {
  return (
    value === "registered" ||
    value === "unregistered" ||
    value === "unsupported"
  );
}

/**
 * Builds the status reported whenever no native floor can be reached -- no module on this host
 * (Expo Go, iOS, a non-prebuilt binary) or a bridge-level rejection. It is the `unsupported`
 * member the persisted snapshot vocabulary already has, never a fabricated `unregistered`: a host
 * without the native floor must not look like a host whose floor is simply switched off.
 */
function createUnsupportedFloorStatus(): NativeBackgroundFloorStatus {
  return { registrationStatus: "unsupported", isBackgroundTaskRegistered: false };
}

/**
 * Normalizes one raw native payload into the closed registration vocabulary.
 *
 * Every field is coerced defensively because the bridge cannot type-check a dictionary:
 * a foreign or missing `registrationStatus` degrades to `unsupported` (this seam cannot name the
 * native side's answer, so it must not claim a lifecycle state), and
 * `isBackgroundTaskRegistered` is true only when the native side sent a literal `true`.
 *
 * Everything normalized here describes the NATIVE floor's own request -- never the retired
 * `expo-background-task` job (see the factory doc): a native enqueue that was not confirmed reports
 * `unregistered`, so a status read can never promote the legacy request to a native floor.
 */
function normalizeNativeBackgroundFloorStatus(
  raw: unknown,
): NativeBackgroundFloorStatus {
  const map = (
    raw && typeof raw === "object" ? raw : {}
  ) as NativeBackgroundFloorStatusMap;

  return {
    registrationStatus: isRegistrationStatus(map.registrationStatus)
      ? map.registrationStatus
      : "unsupported",
    isBackgroundTaskRegistered: map.isBackgroundTaskRegistered === true,
  };
}

/**
 * Runs one native floor operation and resolves its normalized status.
 *
 * This is the whole degraded-path policy of the seam, and it deliberately contains NO fallback
 * to the retired JS floor: when the module is missing or the bridge rejects, the answer is
 * `unsupported` and nothing else happens. Registering the legacy `expo-background-task` job here
 * would recreate the second scheduler this cutover removes, and running a JS cycle here would
 * execute background work in the very place the native engine replaced.
 */
async function runFloorOperation(
  nativeModule: NativeBackgroundFloorModule | null,
  operation: (
    module: NativeBackgroundFloorModule,
  ) => Promise<NativeBackgroundFloorStatusMap>,
): Promise<NativeBackgroundFloorStatus> {
  if (!nativeModule) {
    return createUnsupportedFloorStatus();
  }

  try {
    return normalizeNativeBackgroundFloorStatus(await operation(nativeModule));
  } catch {
    // The Kotlin module resolves rather than rejects by contract; a rejection can only come from
    // the bridge itself (a torn-down runtime, a lookup failure). It must not reach the runtime
    // effect as an exception: an unhandled rejection there would abort the status persist that
    // settings reads.
    return createUnsupportedFloorStatus();
  }
}

/**
 * Creates the execution strategy over the native periodic WorkManager floor (ODD
 * native-background-sync-cutover M3). Kotlin owns the floor end to end: the unique periodic
 * request, its worker, the ticker gate and the status projection. This JS side only asks the
 * native module to register/refresh it, to cancel it, and to report it.
 *
 * **Registration is native-first and cancellation follows confirmation, natively.** `register()`
 * forwards to `registerBackgroundSyncFloor()`, which blocks on WorkManager's own enqueue
 * `Operation` and cancels the pre-native `EXPO_BACKGROUND_WORKER` unique request only after that
 * enqueue is confirmed. `unregister()` forwards to `unregisterBackgroundSyncFloor()`, which
 * cancels BOTH unique names. Neither decision is made here -- the JS layer never sees the legacy
 * work name, so it cannot cancel it by mistake or leave it behind on its own.
 *
 * **Degrades to `unsupported`, never to the JS floor.** When the native module is absent the
 * three operations resolve `unsupported` (see [runFloorOperation]); no `expo-background-task`
 * registration is attempted and no JS cycle is run, so a host without the native module has no
 * background floor at all instead of a silently degraded one. The execution facade preserves that
 * `unsupported` answer whenever every registered strategy reports it, so a host that cannot
 * register any floor reads as `unsupported` in settings instead of as a floor that is merely
 * switched off; a strategy that answers a real `registered`/`unregistered` lifecycle wins over it.
 *
 * **`registrationStatus` and `isBackgroundTaskRegistered` describe the NATIVE floor only.** They
 * are read from the native module's own state for the native WorkManager request, never from the
 * retired `expo-background-task` request. When the native enqueue is not confirmed the native
 * answer is `unregistered`, and this seam does NOT report the still-scheduled legacy request as a
 * registered floor to soften that: the legacy callback is deleted in the next M3 work unit, so
 * calling it the registered floor would hide the loss of the native one. The legacy request may
 * therefore stay pending for the rest of this first unit (the transition is visible as
 * `unregistered`, not as a fabricated success), and `unregister()` cancels both natively.
 *
 * **This strategy does not own the battery-optimization signal.** Only the FGS adapter reads
 * `isBatteryOptimizationExempt`; the concurrent-status OR-merge picks up that adapter's live
 * reading regardless of the safe `false` reported here.
 */
export function createNativeBackgroundFloorStrategy(
  params: CreateNativeBackgroundFloorStrategyParams = {},
): SyncExecutionStrategy {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeBackgroundFloorModule>();
  const nativeModule = loadOptionalNativeModule(
    loadModule,
    NATIVE_BACKGROUND_FLOOR_MODULE_NAME,
  );

  return {
    mode: "best_effort_background_task",

    async register(): Promise<void> {
      await runFloorOperation(nativeModule, (module) =>
        module.registerBackgroundSyncFloor(),
      );
    },

    async unregister(): Promise<void> {
      await runFloorOperation(nativeModule, (module) =>
        module.unregisterBackgroundSyncFloor(),
      );
    },

    async getStatus(): Promise<SyncExecutionStatus> {
      const status = await runFloorOperation(nativeModule, (module) =>
        module.getBackgroundSyncFloorStatus(),
      );

      return {
        registrationStatus: status.registrationStatus,
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: status.isBackgroundTaskRegistered,
        isBatteryOptimizationExempt: false,
      };
    },
  };
}
