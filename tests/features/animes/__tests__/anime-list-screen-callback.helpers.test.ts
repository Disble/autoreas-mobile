import {
  beginChapterAction,
} from "../../../../src/features/animes/chapter-action-diagnostics.helpers";
import type { ChapterActionContext } from "../../../../src/features/animes/chapter-action-diagnostics.types";
import {
  runChapterMutation,
  runManualRefresh,
} from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen-callback.helpers";
import type {
  AnimeListScreenChapterMutationDeps,
  AnimeListScreenManualRefreshDeps,
} from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types";

// The diagnostics recorder is mocked at the seam the runner actually calls: the runner's own
// contract is the ORDER and the VALUES it forwards (the switch it resolved, the receipt it opened),
// not what the recorder does with them -- that is `chapter-action-diagnostics`'s suite.

jest.mock("../../../../src/features/animes/chapter-action-diagnostics.helpers", () => ({
  beginChapterAction: jest.fn(),
}));

/** The context the mocked recorder opens, enough to be identifiable in later phase calls. */
const mockActionContext: ChapterActionContext = {
  action: "capPlus",
  correlationId: "corr-1",
  startedAt: 1_000,
  isTelemetryEnabled: true,
};

/**
 * Builds the runner collaborators a case reads: a telemetry switch and a toast spy.
 * The runner used to also resolve a per-anime lock here; it no longer holds one, because a
 * pending write may not disable or swallow a valid tap.
 */
function buildDeps(overrides: Partial<AnimeListScreenChapterMutationDeps> = {}) {
  const show = jest.fn();

  return {
    deps: {
      isTelemetryEnabled: true,
      toast: { show },
      ...overrides,
    } satisfies AnimeListScreenChapterMutationDeps,
    show,
  };
}

describe("runChapterMutation", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (beginChapterAction as jest.Mock).mockReturnValue(mockActionContext);
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("opens the action before running it and hands the receipt to the mutation", async () => {
    const { deps } = buildDeps();
    const action = jest.fn().mockResolvedValue(undefined);

    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(beginChapterAction).toHaveBeenCalledWith("capPlus", {
      isTelemetryEnabled: true,
    });
    expect(action).toHaveBeenCalledWith("thu-1", mockActionContext);
  });

  it("runs a second tap on the same anime instead of dropping it as in flight", async () => {
    const { deps } = buildDeps();
    const action = jest.fn().mockResolvedValue(undefined);

    await runChapterMutation("thu-1", "capPlus", action, deps);
    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(action).toHaveBeenCalledTimes(2);
    expect(beginChapterAction).toHaveBeenCalledTimes(2);
  });

  it("surfaces a danger toast when the action rejects", async () => {
    const { deps, show } = buildDeps();
    const action = jest.fn().mockRejectedValue(new Error("database is locked"));

    await expect(
      runChapterMutation("thu-1", "capPlus", action, deps),
    ).resolves.toBeUndefined();

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "danger",
        label: "No se pudo guardar el capitulo",
        description: "database is locked",
        duration: 4000,
      }),
    );
  });

  it("stays resolved when the failure toast itself throws", async () => {
    const { deps, show } = buildDeps();
    show.mockImplementationOnce(() => {
      throw new Error("toast renderer exploded");
    });
    const action = jest.fn().mockRejectedValue(new Error("database is locked"));

    await expect(
      runChapterMutation("thu-1", "capPlus", action, deps),
    ).resolves.toBeUndefined();
  });

  it("forwards the resolved telemetry switch and still runs the write when it is off", async () => {
    const { deps } = buildDeps({ isTelemetryEnabled: false });
    const action = jest.fn().mockResolvedValue(undefined);

    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(beginChapterAction).toHaveBeenCalledWith("capPlus", {
      isTelemetryEnabled: false,
    });
    expect(action).toHaveBeenCalledWith("thu-1", mockActionContext);
  });
});

/** Builds the refresh runner collaborators: a sync spy, a refreshing-state spy and a toast spy. */
function buildRefreshDeps(manualSync: AnimeListScreenManualRefreshDeps["manualSync"]) {
  const show = jest.fn();
  const setIsRefreshing = jest.fn();

  return {
    deps: {
      manualSync,
      setIsRefreshing,
      syncFacts: {
        connectionStatus: "idle",
        isBridgeConfigured: true,
        isDeviceOnline: false,
        lastSyncAt: null,
        pendingOpsCount: 0,
      },
      toast: { show },
    } satisfies AnimeListScreenManualRefreshDeps,
    setIsRefreshing,
    show,
  };
}

describe("runManualRefresh", () => {
  it("shows the spinner while the sync runs and hides it after a success, with no toast", async () => {
    const { deps, setIsRefreshing, show } = buildRefreshDeps(jest.fn().mockResolvedValue(undefined));

    await runManualRefresh(deps);

    expect(deps.manualSync).toHaveBeenCalledTimes(1);
    expect(setIsRefreshing.mock.calls).toEqual([[true], [false]]);
    expect(show).not.toHaveBeenCalled();
  });

  it("stays resolved, warns with the offline copy and hides the spinner when the sync rejects", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps, setIsRefreshing, show } = buildRefreshDeps(
      jest.fn().mockRejectedValue(new Error("boom")),
    );

    await expect(runManualRefresh(deps)).resolves.toBeUndefined();

    expect(setIsRefreshing.mock.calls).toEqual([[true], [false]]);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "warning", duration: 4000 }),
    );
    expect(warn).toHaveBeenCalledWith("[AnimeListScreen] Manual refresh failed:", expect.any(Error));
    warn.mockRestore();
  });
});
