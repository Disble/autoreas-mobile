import { act, renderHook } from "@testing-library/react-native";
import { useNetworkState } from "expo-network";
import type { AnimeDayFilter } from "../../../../src/features/animes/anime.types";
import { useAnimeListScreen } from "../../../../src/features/animes/ui/AnimeListScreen/use-anime-list-screen";
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

/**
 * The acceptance decision the recorder consults, stubbed to ACCEPT the chapter kind by default.
 *
 * The bridge does not declare this kind yet, so the phase assertions below would otherwise have no
 * observations left to read, and the screen-to-recorder wiring the bridge will start reading the
 * day the registry flips would sit unguarded until then. Stubbing the DECISION keeps those
 * assertions driving the real callback path, while the last case in this file re-arms the real
 * decision and proves the production truth: with the registry as it ships, a tap enqueues nothing.
 */
jest.mock("../../../../src/features/sync/sync-diagnostics-flush.helpers", () => {
  const actual = jest.requireActual("../../../../src/features/sync/sync-diagnostics-flush.helpers") as {
    readonly isSyncDiagnosticsPayloadAccepted: (payload: unknown) => boolean;
  };

  return { ...actual, isSyncDiagnosticsPayloadAccepted: jest.fn(() => true) };
});

/** The acceptance decision as it actually ships, read from the real module this file replaces. */
const actualIsSyncDiagnosticsPayloadAccepted = (
  jest.requireActual("../../../../src/features/sync/sync-diagnostics-flush.helpers") as {
    readonly isSyncDiagnosticsPayloadAccepted: (payload: unknown) => boolean;
  }
).isSyncDiagnosticsPayloadAccepted;

/** The stub of that decision which the recorder actually consults in this suite. */
const mockIsSyncDiagnosticsPayloadAccepted = (
  jest.requireMock("../../../../src/features/sync/sync-diagnostics-flush.helpers") as {
    isSyncDiagnosticsPayloadAccepted: jest.Mock;
  }
).isSyncDiagnosticsPayloadAccepted;

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
    // Re-armed for every case: the phase cases below run with the kind ACCEPTED (see the mock's own
    // comment), and the last case installs the real decision for itself only.
    mockIsSyncDiagnosticsPayloadAccepted.mockReturnValue(true);
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

  it("enqueues nothing for a tap while the bridge does not accept the chapter kind", async () => {
    // The production truth of this suite, asserted with the REAL registry instead of the stub
    // above: the bridge answers 400 for a `kind` it does not declare and the flush deletes a 400,
    // so the tap boundary must stay entirely off the wire. The mutation itself is untouched.
    mockIsSyncDiagnosticsPayloadAccepted.mockImplementation(actualIsSyncDiagnosticsPayloadAccepted);
    mockCapPlus.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAnimeListScreen({}));

    await act(async () => {
      await result.current.handleCapPlus("thu-1");
    });

    expect(readPersistedEntries()).toHaveLength(0);
    // The user's own write still happened: this gate is a diagnostics decision, never a gate on
    // the mutation the button was pressed for.
    expect(mockCapPlus).toHaveBeenCalledWith(
      "thu-1",
      expect.objectContaining({ action: "capPlus", correlationId: expect.any(String) }),
    );
  });
});
