import { act, renderHook } from "@testing-library/react-native";
import { useNetworkState } from "expo-network";
import type { AnimeDayFilter } from "../../../../src/features/animes/anime.types";
import { useAnimeListScreen } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen";
import { isSyncDiagnosticsPayloadAccepted } from "../../../../src/features/sync/sync-diagnostics-flush.helpers";
import type { SyncDiagnosticsOutboxEntry } from "../../../../src/infrastructure/db/sync-diagnostics-outbox";
import type { Anime } from "../../../../src/infrastructure/validation/anime-schema";

/** Chapter-command fake the mocked `useMutateAnime` hands to the list screen. */
const mockCapPlus = jest.fn();
/** Fast-decrement fake, so a case can tell the two labels' observations apart. */
const mockCapMinus = jest.fn();
/** Half-increment fake. */
const mockCapPlusHalf = jest.fn();
/** Half-decrement fake. */
const mockCapMinusHalf = jest.fn();
/** Estado fake: its flow is deliberately NOT instrumented, and must stay quiet. */
const mockSetEstado = jest.fn();
/** Controls the anime list the screen renders for each day filter. */
const mockUseAnimeList = jest.fn();
/** Controls the responsive layout the screen derives from. */
const mockUseResponsiveLayout = jest.fn();

jest.mock("expo-network", () => ({
  useNetworkState: jest.fn(),
}));

/**
 * Stable toast double. The shared bootstrap mock builds a NEW toast object per call, which makes
 * the screen's callbacks change identity on every render anyway -- and that would hide a missing
 * dependency entry behind an unrelated re-creation, exactly the stale closure the toggle case
 * below exists to catch.
 */
const mockToast = { show: jest.fn(), hide: jest.fn() };

jest.mock("heroui-native", () => ({
  useThemeColor: jest.fn(() => ["#000000"]),
  useToast: jest.fn(() => ({ toast: mockToast, isToastVisible: false })),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("../../../../src/contexts/app-theme-context", () => ({
  useAppTheme: jest.fn(() => ({ isDark: false })),
}));

jest.mock("../../../../src/features/settings/use-bridge-config", () => ({
  useBridgeConfig: jest.fn(() => mockBuildBridgeConfigResult()),
}));

jest.mock("../../../../src/features/animes/use-mutate-anime", () => ({
  useMutateAnime: jest.fn(() => ({
    capMinus: mockCapMinus,
    capPlus: mockCapPlus,
    capMinusHalf: mockCapMinusHalf,
    capPlusHalf: mockCapPlusHalf,
    setEstado: mockSetEstado,
  })),
}));

jest.mock("../../../../src/features/animes/use-anime-list", () => ({
  useAnimeList: (...args: unknown[]) => mockUseAnimeList(...args),
}));

jest.mock("../../../../src/features/sync/use-sync-facade", () => ({
  useSyncFacade: jest.fn(() => ({
    connectionStatus: "offline",
    lastSyncAt: null,
    manualSync: jest.fn(),
    pendingOpsCount: 0,
    requestSync: jest.fn(),
    syncError: null,
  })),
}));

jest.mock("../../../../src/hooks/use-responsive-layout", () => ({
  useResponsiveLayout: (...args: unknown[]) => mockUseResponsiveLayout(...args),
}));

// The recorder resolves this store by default. Replacing it in the module registry is what lets a
// case read exactly what the list screen persisted, without a SQLite file and without asserting on
// an internal collaborator's call count: the assertions below read the durable payload itself.
jest.mock(
  "../../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants",
  () => ({ syncDiagnosticsOutboxStore: { enqueue: jest.fn() } }),
);

/** The diagnostics outbox the list screen writes to, mocked above. */
const mockDiagnosticsOutbox = jest.requireMock(
  "../../../../src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants",
) as { syncDiagnosticsOutboxStore: { enqueue: jest.Mock } };

// NO STUB OF THE ACCEPTANCE DECISION LIVES HERE ANY MORE. This file used to replace
// `isSyncDiagnosticsPayloadAccepted` with a stub that always answered `true`, because the registry
// carried no chapter kind and the recorder legitimately refused to enqueue one; the tap assertions
// below would otherwise have had no observations to read. `SYNC_DIAGNOSTICS_ACCEPTED_KINDS` now
// names `episode_action`, so the REAL decision accepts the very payload a tap produces and the stub
// had become a second copy of a fact production already states. Every case below reads the registry
// as it ships; the last one pins the refusal side on a kind no build here names.
/** The mocked bridge-config hook, re-pointed by the cases that exercise the telemetry switch. */
const { useBridgeConfig: mockUseBridgeConfig } = jest.requireMock(
  "../../../../src/features/settings/use-bridge-config",
) as { useBridgeConfig: jest.Mock };

/**
 * Builds the mocked `useBridgeConfig()` result, i.e. the pairing row the screen reads its
 * telemetry switch from. The default states NO switch at all: that is the device that never
 * opened Settings, which the switch's own nullish rule treats as enabled.
 */
function mockBuildBridgeConfigResult(
  config: { deviceId: string; isSyncTelemetryEnabled?: boolean } = {
    deviceId: "bridge-1",
  },
) {
  return {
    config,
    isConfigured: true,
    isUnpairing: false,
    error: null,
    unpair: jest.fn(),
  };
}

/** One anime fixture, enough for `useAnimeList` to return a non-empty list. */
const animeFixture: Anime = {
  _id: "thu-1",
  nombre: "Thursday Anime",
  estado: 0,
  nrocapvisto: 0,
  totalcap: null,
  dias: [{ dia: "Jueves", orden: 0 }],
  generos: [],
  tipo: null,
  activo: 1,
  primeravez: 0,
  fechaUltCapVisto: null,
  fechaEstreno: null,
  fechaCreacion: null,
  fechaEliminacion: null,
  portada: null,
  pagina: null,
  carpeta: null,
  estudios: null,
  origen: null,
  duracion: null,
};

/** Reads every observation the list screen persisted, in write order. */
function readPersistedEntries(): readonly SyncDiagnosticsOutboxEntry[] {
  return mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue.mock.calls.map(
    (call) => call[0] as SyncDiagnosticsOutboxEntry,
  );
}

/** Parses one persisted observation back into the object that was stored. */
function parsePayload(entry: SyncDiagnosticsOutboxEntry): Record<string, unknown> {
  return JSON.parse(entry.payload) as Record<string, unknown>;
}

describe("useAnimeListScreen chapter action diagnostics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDiagnosticsOutbox.syncDiagnosticsOutboxStore.enqueue.mockReset();
    mockUseBridgeConfig.mockReturnValue(mockBuildBridgeConfigResult());
    (useNetworkState as jest.Mock).mockReturnValue({
      isConnected: true,
      isInternetReachable: true,
    });
    mockUseAnimeList.mockImplementation((filter: AnimeDayFilter) => ({
      data: filter === "Jueves" ? [animeFixture] : [],
      allActiveAnimes: [animeFixture],
    }));
    mockUseResponsiveLayout.mockReturnValue({ layout: "phone", isCompact: true });
  });

  it("persists a received observation when the enabled chapter callback runs", async () => {
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    const entries = readPersistedEntries();
    expect(entries).toHaveLength(1);
    expect(parsePayload(entries[0])).toEqual({
      kind: "episode_action",
      observation_id: expect.any(String),
      action: "episode_plus_one",
      phase: "received",
      observed_at_ms: expect.any(Number),
      correlation_id: expect.any(String),
      duration_ms: null,
    });
  });

  it("persists the dropped repeat as skipped/in_flight, sharing one correlation per tap", async () => {
    let releaseFirstTap!: () => void;
    mockCapPlus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstTap = resolve;
        }),
    );

    const { result } = renderHook(() => useAnimeListScreen({}));

    let firstTap: Promise<void>;
    let droppedTap: Promise<void>;
    await act(async () => {
      firstTap = result.current.handleCapPlus("thu-1");
      droppedTap = result.current.handleCapPlus("thu-1");
    });

    await act(async () => {
      releaseFirstTap();
      await Promise.all([firstTap, droppedTap]);
    });

    // Three rows, not two: `received` is per callback that actually ran, and the guard dropped the
    // SECOND one. Collapsing the two taps into one row set would make a double tap indistinguishable
    // from a single one, which is the exact question this feed exists to answer.
    const entries = readPersistedEntries();
    expect(mockCapPlus).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(3);

    const [firstReceived, droppedReceived, droppedSkipped] = entries.map(parsePayload);
    expect(firstReceived).toMatchObject({ action: "episode_plus_one", phase: "received" });
    expect(droppedReceived).toMatchObject({ action: "episode_plus_one", phase: "received" });
    expect(droppedSkipped).toMatchObject({
      action: "episode_plus_one",
      phase: "skipped",
      reason: "in_flight",
    });
    expect(droppedSkipped.correlation_id).toBe(droppedReceived.correlation_id);
    expect(droppedReceived.correlation_id).not.toBe(firstReceived.correlation_id);
    expect(new Set(entries.map((entry) => entry.cycleId)).size).toBe(3);
  });

  it("persists the same phases as before when the switch is explicitly on", async () => {
    mockUseBridgeConfig.mockReturnValue(
      mockBuildBridgeConfigResult({ deviceId: "bridge-1", isSyncTelemetryEnabled: true }),
    );
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    const entries = readPersistedEntries();
    expect(entries).toHaveLength(1);
    expect(parsePayload(entries[0])).toEqual({
      kind: "episode_action",
      observation_id: expect.any(String),
      action: "episode_plus_one",
      phase: "received",
      observed_at_ms: expect.any(Number),
      correlation_id: expect.any(String),
      duration_ms: null,
    });
  });

  it("persists nothing for a tap while the switch is off, and still runs the mutation", async () => {
    mockUseBridgeConfig.mockReturnValue(
      mockBuildBridgeConfigResult({ deviceId: "bridge-1", isSyncTelemetryEnabled: false }),
    );
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    // Not even the receipt: the tap boundary itself must be muted, since a row queued here would
    // be POSTed later by the flush once the switch came back on.
    expect(readPersistedEntries()).toHaveLength(0);
    // The switch gates telemetry only -- the user's own write still happened.
    expect(mockCapPlus).toHaveBeenCalledWith(
      "thu-1",
      expect.objectContaining({ action: "capPlus", correlationId: expect.any(String) }),
    );
  });

  it("persists nothing for a repeat tap dropped in flight while the switch is off", async () => {
    mockUseBridgeConfig.mockReturnValue(
      mockBuildBridgeConfigResult({ deviceId: "bridge-1", isSyncTelemetryEnabled: false }),
    );
    let releaseFirstTap!: () => void;
    mockCapPlus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstTap = resolve;
        }),
    );

    const { result } = renderHook(() => useAnimeListScreen({}));

    let firstTap: Promise<void>;
    let droppedTap: Promise<void>;
    await act(async () => {
      firstTap = result.current.handleCapPlus("thu-1");
      droppedTap = result.current.handleCapPlus("thu-1");
    });

    await act(async () => {
      releaseFirstTap();
      await Promise.all([firstTap, droppedTap]);
    });

    // Both boundary calls are gated: the dropped repeat's `skipped/in_flight` is as muted as the
    // receipt of the tap it dropped.
    expect(mockCapPlus).toHaveBeenCalledTimes(1);
    expect(readPersistedEntries()).toHaveLength(0);
  });

  it("honours a switch turned off while the screen stays mounted", async () => {
    // Mounted with the switch ON, so the tap boundary's callback exists before the toggle.
    mockUseBridgeConfig.mockReturnValue(
      mockBuildBridgeConfigResult({ deviceId: "bridge-1", isSyncTelemetryEnabled: true }),
    );
    mockCapPlus.mockResolvedValue(undefined);

    const { result, rerender } = renderHook(() => useAnimeListScreen({}), {
      initialProps: { tick: 0 },
    });

    // The user flips it off in Settings; this screen re-renders with the new row, exactly as a
    // live query would deliver it.
    mockUseBridgeConfig.mockReturnValue(
      mockBuildBridgeConfigResult({ deviceId: "bridge-1", isSyncTelemetryEnabled: false }),
    );
    rerender({ tick: 1 });

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    // A callback that closed over the pre-toggle value would still enqueue here.
    expect(readPersistedEntries()).toHaveLength(0);
  });

  it("persists the tap's receipt now that the registry serves the chapter kind, without gating the mutation", async () => {
    // CONTRACT CORRECTION, not an inversion to make a red test green: this case used to assert that
    // the tap boundary stayed entirely off the wire, because the registry carried no chapter kind
    // and the flush deletes a body its 400 condemns. The registry now names the kind the bridge
    // serves (v1.15.0), so the same tap persists its `received` observation through the REAL
    // decision. The mutation itself is untouched: this gate is a diagnostics decision, never a gate
    // on the write the button was pressed for.
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    const entries = readPersistedEntries();
    expect(entries).toHaveLength(1);
    expect(parsePayload(entries[0])).toEqual({
      kind: "episode_action",
      observation_id: expect.any(String),
      action: "episode_plus_one",
      phase: "received",
      observed_at_ms: expect.any(Number),
      correlation_id: expect.any(String),
      duration_ms: null,
    });
    expect(mockCapPlus).toHaveBeenCalledWith(
      "thu-1",
      expect.objectContaining({ action: "capPlus", correlationId: expect.any(String) }),
    );

    // And the admission is the REGISTRY's, never a blanket yes: the decision as it ships accepts
    // the kind this build emits and still refuses a kind no build here names.
    expect(isSyncDiagnosticsPayloadAccepted({ kind: "episode_action" })).toBe(true);
    expect(isSyncDiagnosticsPayloadAccepted({ kind: "watch_session" })).toBe(false);
  });
});
