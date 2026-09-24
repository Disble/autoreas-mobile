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

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("../../../../src/contexts/app-theme-context", () => ({
  useAppTheme: jest.fn(() => ({ isDark: false })),
}));

jest.mock("../../../../src/features/settings/use-bridge-config", () => ({
  useBridgeConfig: jest.fn(() => ({
    config: { deviceId: "bridge-1" },
    isConfigured: true,
    isUnpairing: false,
    error: null,
    unpair: jest.fn(),
  })),
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
      kind: "chapter_action",
      action: "cap_plus",
      phase: "received",
      at: expect.any(Number),
      correlation_id: expect.any(String),
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
    expect(firstReceived).toMatchObject({ action: "cap_plus", phase: "received" });
    expect(droppedReceived).toMatchObject({ action: "cap_plus", phase: "received" });
    expect(droppedSkipped).toMatchObject({
      action: "cap_plus",
      phase: "skipped",
      reason: "in_flight",
    });
    expect(droppedSkipped.correlation_id).toBe(droppedReceived.correlation_id);
    expect(droppedReceived.correlation_id).not.toBe(firstReceived.correlation_id);
    expect(new Set(entries.map((entry) => entry.cycleId)).size).toBe(3);
  });
});
