import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { createNativeForegroundSyncAdapter } from "./native-foreground-sync-adapter";
import { createNativeBackgroundFloorStrategy } from "./native-background-floor";
import { useBridgeConfig } from "../settings/use-bridge-config";
import { useWebSocket } from "../ws/use-websocket";
import { createSyncExecutionFacade } from "./sync-execution-facade";
import { buildSyncExecutionStatusPatch } from "./sync-execution-strategy.helpers";
import { dispatchForegroundSyncFlush } from "./sync-facade.helpers";
import { registerSyncFlushDispatcher } from "./sync-flush.helpers";
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
  const { clearActiveSeason } = useSeasonSync({
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
        | "ws_sync_required"
        | "ws_reconnected"
        | "ws_disconnected"
        | "ws_season_changed"
        | "ws_preferences_changed",
    ) => {
      void requestSync(source).catch(() => undefined);
    },
    [requestSync],
  );

  const handleWebSocketSyncRequired = useCallback(() => {
    requestAutomaticSync("ws_sync_required");
  }, [requestAutomaticSync]);

  // A reconnect is the catch-up (ADR 009 R-7): the dispatched cycle pulls since the cursor, drains
  // the staged changes and heals the snapshot only when the last successful heal is stale. The
  // socket never reports a first attempt that succeeds, which the mount or resume flush covers.
  const handleWebSocketReconnected = useCallback(() => {
    requestAutomaticSync("ws_reconnected");
  }, [requestAutomaticSync]);

  // A drop of an open socket re-checks the bridge (ADR 009 R-9): the drop alone proves nothing
  // about HTTP, so the cycle's own outcome decides whether the status still claims it reachable.
  // Single-flight: a flapping socket runs at most one cycle plus one follow-up.
  const handleWebSocketDisconnected = useCallback(() => {
    requestAutomaticSync("ws_disconnected");
  }, [requestAutomaticSync]);

  // Both WebSocket season events go through the entry point (ADR 009 R-2, I8): the dispatched
  // cycle refreshes and caches the active season. Season mode switched off is a local clear only;
  // it asks the bridge for nothing, so there is nothing to send.
  const handlePreferencesChanged = useCallback(
    (seasonMode: boolean) => {
      if (seasonMode) {
        requestAutomaticSync("ws_preferences_changed");
        return;
      }

      void clearActiveSeason().catch(() => undefined);
    },
    [clearActiveSeason, requestAutomaticSync],
  );

  const handleSeasonChanged = useCallback(() => {
    requestAutomaticSync("ws_season_changed");
  }, [requestAutomaticSync]);

  // 7. Effects
  // The JS dispatcher exists while the foreground runtime is mounted: from here on, every
  // `requestFlush` (a kick after a local write included) runs the coordinated cycle. Declared
  // first so the bootstrap request below already finds it.
  useEffect(() => registerSyncFlushDispatcher(dispatchForegroundSyncFlush), []);

  useWebSocket({
    enabled: isWebSocketEnabled,
    onSeasonChanged: handleSeasonChanged,
    onSyncRequired: handleWebSocketSyncRequired,
    onPreferencesChanged: handlePreferencesChanged,
    onReconnected: handleWebSocketReconnected,
    onDisconnected: handleWebSocketDisconnected,
  });

  // Drains background-staged remote changes into `animes` on the foreground reactive
  // connection (mount + app-resume) so headless sync results become visible without an
  // app restart. Mounted at the runtime root alongside WS/AppState/network wiring since it
  // shares the same foreground-only lifecycle.
  useRemoteChangeDrain();

  // Cover hydration on mount + app-resume. The snapshot-authoritative heal those events trigger is
  // a demand of the dispatched `bootstrap` and `app_active` cycles below (ADR 009 R-7), so it is
  // single-flight with every other trigger.
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
