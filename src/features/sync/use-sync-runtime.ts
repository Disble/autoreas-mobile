import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { createNativeForegroundSyncAdapter } from "./native-foreground-sync-adapter";
import { createNativeBackgroundFloorStrategy } from "./native-background-floor";
import { useBridgeConfig } from "../settings/use-bridge-config";
import { useWebSocket } from "../ws/use-websocket";
import { createSyncExecutionFacade } from "./sync-execution-facade";
import { buildSyncExecutionStatusPatch } from "./sync-execution-strategy.helpers";
import { updateSyncRuntimeStatusSnapshot } from "./sync-runtime-status.helpers";
import { useForegroundResync } from "./use-foreground-resync";
import { useRemoteChangeDrain } from "./use-remote-change-drain";
import { useSeasonSync } from "./use-season-sync";
import { useSyncFacade } from "./use-sync-facade";
import type {
  UseSyncRuntimeProps,
  UseSyncRuntimeResult,
} from "./sync-runtime.types";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime/native-runtime.helpers";

/** Coordinates sync runtime state and actions. */
export function useSyncRuntime(
  props: UseSyncRuntimeProps,
): UseSyncRuntimeResult {
  // 1. Refs
  const hasBootstrappedRef = useRef(false);
  const currentAppStateRef = useRef(AppState.currentState);
  const lastConnectivityRef = useRef<boolean | null>(null);
  // Monotonic projection ordering. Every projection captures the sequence BEFORE it awaits the
  // facade, and only the newest sequence may persist: three writers share the singleton row, so an
  // in-flight projection that started before a deliberate disable must never overwrite the
  // `unregistered` that disable wrote.
  const projectionSequenceRef = useRef(0);
  // Bumped when registration starts and resolves: the first bounded re-read still runs if one
  // strategy never settles; the second gives an eventual completion its own settle window.
  // A counter (not a ref) so the timer can live in its own effect with a cleanup, and a dependency
  // change mid-window tears that effect down and re-runs it while the request stands, so the settle
  // pass is never silently dropped.
  const [settleRequest, setSettleRequest] = useState(0);

  // 2. State
  const [currentAppState, setCurrentAppState] = useState(AppState.currentState);
  const [executionMode, setExecutionMode] = useState<
    "best_effort_background_task" | "android_foreground_service"
  >("best_effort_background_task");

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { isConfigured } = useBridgeConfig();
  const { requestSync } = useSyncFacade();
  const { clearActiveSeason, refreshActiveSeason } = useSeasonSync({
    enabled: props.isBootstrapped && isConfigured && currentAppState === "active",
  });

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const isRuntimeEnabled = useMemo(
    () => props.isBootstrapped && isConfigured,
    [isConfigured, props.isBootstrapped],
  );
  const isWebSocketEnabled = useMemo(
    () => isRuntimeEnabled && currentAppState === "active",
    [currentAppState, isRuntimeEnabled],
  );
  const syncExecutionFacade = useMemo(
    () =>
      createSyncExecutionFacade({
        strategies: [
          createNativeForegroundSyncAdapter(),
          // Registration is native WorkManager now. The retired Expo task that used to sit here is
          // no longer registered from JS; the pre-native `EXPO_BACKGROUND_WORKER` request is
          // retired only once the native enqueue is CONFIRMED, and an unconfirmed enqueue leaves it
          // pending while reporting the NATIVE floor as unregistered (see `native-background-floor`).
          // That seam answers `unsupported`, never a JS cycle, when the native module is absent.
          createNativeBackgroundFloorStrategy(),
        ],
      }),
    [],
  );

  // Registration only requests an asynchronous service start. Re-read after a short window
  // during registration and again after completion; neither window polls.
  const executionStatusSettleDelayMs = 1500;

  // 6. Callbacks (`useCallback` calling pure helpers)

  /**
   * Re-reads the live execution status and persists it into the singleton runtime row.
   *
   * Extracted from the registration and disable paths because this read is NOT a one-shot fact:
   * the native foreground-service start is only requested at registration time and confirms later,
   * so persisting the first reading permanently is what made the row assert a fact that was false
   * by construction. Re-calling this is what keeps the row honest.
   *
   * `registrationStatus` is forced to `unregistered` whenever the runtime is not enabled. The
   * facade answers `unsupported` for a disabled runtime -- "this host cannot register a floor at
   * all" -- because registration released every strategy, and that is not what happened: the user
   * switched the floor off. `unregistered` is the honest value, and deriving it from the runtime's
   * own enabled state (rather than from the caller) is what keeps a late projection from reviving a
   * registered verdict after a disable.
   *
   * **Only the newest projection may write.** The read awaits the facade before persisting, so a
   * projection started earlier can finish later; without the sequence guard a slow one could land
   * after a disable and claim the floor is live again.
   */
  const projectExecutionStatus = useCallback(async () => {
    if (!rawDb) {
      return;
    }

    const sequence = projectionSequenceRef.current + 1;
    projectionSequenceRef.current = sequence;

    const status = await syncExecutionFacade.getStatus();

    if (sequence !== projectionSequenceRef.current) {
      return;
    }

    setExecutionMode(status.executionMode);

    const patch = buildSyncExecutionStatusPatch(status);

    await updateSyncRuntimeStatusSnapshot(
      rawDb,
      isRuntimeEnabled
        ? patch
        : { ...patch, registrationStatus: "unregistered" },
    );
  }, [isRuntimeEnabled, rawDb, syncExecutionFacade]);

  /**
   * The single bounded settle re-read, at most one timer at a time. Registration only REQUESTS the
   * asynchronous foreground-service start, so the read taken when it resolves still observes that
   * path as down; this one delayed pass gives the notification and the WorkManager enqueue time to
   * land. It is a `setTimeout` owned by this effect's cleanup, never an interval, and it is armed
   * once while registration is pending and again if it resolves (only while enabled).
   */
  useEffect(() => {
    if (settleRequest === 0 || !isRuntimeEnabled) {
      return;
    }

    const settleTimeout = setTimeout(() => {
      void projectExecutionStatus().catch(() => undefined);
    }, executionStatusSettleDelayMs);

    return () => {
      clearTimeout(settleTimeout);
    };
  }, [
    executionStatusSettleDelayMs,
    isRuntimeEnabled,
    projectExecutionStatus,
    settleRequest,
  ]);

  const requestAutomaticSync = useCallback(
    (
      source:
        | "bootstrap"
        | "app_active"
        | "network_regained"
        | "ws_sync_required",
    ) => {
      void requestSync(source).catch(() => undefined);
    },
    [requestSync],
  );

  const handleWebSocketSyncRequired = useCallback(() => {
    requestAutomaticSync("ws_sync_required");
  }, [requestAutomaticSync]);

  const handlePreferencesChanged = useCallback(
    (seasonMode: boolean) => {
      if (seasonMode) {
        void refreshActiveSeason().catch(() => undefined);
        return;
      }

      void clearActiveSeason().catch(() => undefined);
    },
    [clearActiveSeason, refreshActiveSeason],
  );

  const handleSeasonChanged = useCallback(() => {
    void refreshActiveSeason().catch(() => undefined);
  }, [refreshActiveSeason]);

  // 7. Effects
  useWebSocket({
    enabled: isWebSocketEnabled,
    onSeasonChanged: handleSeasonChanged,
    onSyncRequired: handleWebSocketSyncRequired,
    onPreferencesChanged: handlePreferencesChanged,
  });

  // Drains background-staged remote changes into `animes` on the foreground reactive
  // connection (mount + app-resume) so headless sync results become visible without an
  // app restart. Mounted at the runtime root alongside WS/AppState/network wiring since it
  // shares the same foreground-only lifecycle.
  useRemoteChangeDrain();

  // Snapshot-authoritative heal on mount + app-resume: pulls the bridge's full anime list and
  // converges any rows that drifted out of sync (or changes a background cycle missed),
  // skipping animes with un-acked local outbox ops. Replaces the need for a manual refresh.
  useForegroundResync();

  useEffect(() => {
    if (!props.isBootstrapped) {
      return;
    }

    if (!rawDb) {
      return;
    }

    if (!isRuntimeEnabled) {
      hasBootstrappedRef.current = false;
      // The native floor's own cancel is the ONLY floor cancel left: it retires the native
      // request AND the pre-native `EXPO_BACKGROUND_WORKER` unique work, so an upgraded install
      // cannot keep waking up through a request whose JS task no longer exists.
      // No settle pass runs while disabled: the settle effect is gated on `isRuntimeEnabled`, so
      // this clears itself when the runtime is switched off.
      void syncExecutionFacade
        .unregisterCurrentStrategy()
        // No explicit status argument: a disabled runtime forces `unregistered` inside
        // `projectExecutionStatus`, so a late projection cannot revive a registered verdict.
        .then(() => projectExecutionStatus())
        .catch(() => undefined);
      return;
    }

    let cancelled = false;
    if (syncExecutionFacade.hasCurrentStrategy()) {
      return;
    }

    // The facade publishes readable strategies synchronously, before the registration promises
    // resolve. Read them now, and schedule a bounded re-read even if one path remains pending.
    const registration = syncExecutionFacade.registerConcurrentStrategies();
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setSettleRequest((request) => request + 1);
      }
    });
    void projectExecutionStatus().catch(() => undefined);
    void registration
      .then(() => {
        if (cancelled) {
          return;
        }
        // A completed registration gets a fresh settle window even if the pending-registration
        // window elapsed during a slow permission or native enqueue round trip.
        setSettleRequest((request) => request + 1);
      })
      .catch(() =>
        updateSyncRuntimeStatusSnapshot(rawDb, {
          registrationStatus: "unsupported",
        }).catch(() => undefined),
      );
    return () => {
      cancelled = true;
    };
  }, [
    isRuntimeEnabled,
    projectExecutionStatus,
    props.isBootstrapped,
    rawDb,
    syncExecutionFacade,
  ]);

  useEffect(() => {
    if (!isRuntimeEnabled) {
      hasBootstrappedRef.current = false;
      return;
    }

    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    requestAutomaticSync("bootstrap");
  }, [isRuntimeEnabled, requestAutomaticSync]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;
      setCurrentAppState(nextAppState);

      if (
        previousAppState !== "active" &&
        nextAppState === "active" &&
        isRuntimeEnabled
      ) {
        requestAutomaticSync("app_active");
        // Re-project on resume: the facts behind the persisted row change while the app is
        // backgrounded (the floor completes an attempt, the service comes up or dies) and nothing
        // else re-reads them without a new registration.
        void projectExecutionStatus().catch(() => undefined);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isRuntimeEnabled, projectExecutionStatus, requestAutomaticSync]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      const isConnected = state.isConnected === true;

      if (
        lastConnectivityRef.current === false &&
        isConnected &&
        isRuntimeEnabled
      ) {
        requestAutomaticSync("network_regained");
      }

      lastConnectivityRef.current = isConnected;
    });

    return () => {
      subscription.remove();
    };
  }, [isRuntimeEnabled, requestAutomaticSync]);

  return {
    currentAppState,
    executionMode,
    isRuntimeEnabled,
    isWebSocketEnabled,
  };
}
