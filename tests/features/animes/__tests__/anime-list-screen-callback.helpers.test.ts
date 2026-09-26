import {
  beginChapterAction,
  recordChapterActionSkipped,
} from "../../../../src/features/animes/chapter-action-diagnostics.helpers";
import type { ChapterActionContext } from "../../../../src/features/animes/chapter-action-diagnostics.types";
import { runChapterMutation } from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen-callback.helpers";
import type { AnimeListScreenChapterMutationDeps } from "../../../../src/features/animes/ui/AnimeListScreen/anime-list-screen.types";

// The diagnostics recorder is mocked at the seam the runner actually calls: the runner's own
// contract is the ORDER and the VALUES it forwards (the switch it resolved, the skip reason it
// saw), not what the recorder does with them -- that is `chapter-action-diagnostics`'s suite.

jest.mock("../../../../src/features/animes/chapter-action-diagnostics.helpers", () => ({
  beginChapterAction: jest.fn(),
  recordChapterActionSkipped: jest.fn(),
}));

/** The context the mocked recorder opens, enough to be identifiable in later phase calls. */
const mockActionContext: ChapterActionContext = {
  action: "capPlus",
  correlationId: "corr-1",
  startedAt: 1_000,
  isTelemetryEnabled: true,
};

/**
 * Builds the runner collaborators a case reads: a fresh same-anime lock record, a setState spy and
 * a toast spy, plus the handles the assertions read.
 */
function buildDeps(
  initialLock: Record<string, boolean> = {},
  overrides: Partial<AnimeListScreenChapterMutationDeps> = {},
) {
  const show = jest.fn();
  const setIsMutatingAnimeById = jest.fn();
  const mutatingAnimeByIdRef = { current: { ...initialLock } };

  return {
    deps: {
      isTelemetryEnabled: true,
      mutatingAnimeByIdRef,
      setIsMutatingAnimeById,
      toast: { show },
      ...overrides,
    } satisfies AnimeListScreenChapterMutationDeps,
    mutatingAnimeByIdRef,
    setIsMutatingAnimeById,
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

  it("acquires the same-anime lock before the action's first await and releases it after", async () => {
    const { deps, mutatingAnimeByIdRef } = buildDeps();
    let lockObservedByAction: Record<string, boolean> | null = null;
    const action = jest.fn(async () => {
      lockObservedByAction = { ...mutatingAnimeByIdRef.current };
    });

    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(lockObservedByAction).toEqual({ "thu-1": true });
    expect(mutatingAnimeByIdRef.current).toEqual({});
    expect(action).toHaveBeenCalledWith("thu-1", mockActionContext);
  });

  it("opens the action before the guard and records a dropped repeat as in_flight", async () => {
    const { deps, mutatingAnimeByIdRef } = buildDeps({ "thu-1": true });
    const action = jest.fn();

    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(beginChapterAction).toHaveBeenCalledWith("capPlus", {
      isTelemetryEnabled: true,
    });
    expect(recordChapterActionSkipped).toHaveBeenCalledWith(
      mockActionContext,
      "in_flight",
      { isTelemetryEnabled: true },
    );
    expect(action).not.toHaveBeenCalled();
    expect(mutatingAnimeByIdRef.current).toEqual({ "thu-1": true });
  });

  it("releases the lock and surfaces a danger toast when the action rejects", async () => {
    const { deps, mutatingAnimeByIdRef, show } = buildDeps();
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
    expect(mutatingAnimeByIdRef.current).toEqual({});
  });

  it("stays resolved and releases the lock when the failure toast itself throws", async () => {
    const { deps, mutatingAnimeByIdRef, show } = buildDeps();
    show.mockImplementationOnce(() => {
      throw new Error("toast renderer exploded");
    });
    const action = jest.fn().mockRejectedValue(new Error("database is locked"));

    await expect(
      runChapterMutation("thu-1", "capPlus", action, deps),
    ).resolves.toBeUndefined();

    expect(mutatingAnimeByIdRef.current).toEqual({});
  });

  it("forwards the resolved telemetry switch and still runs the write when it is off", async () => {
    const { deps } = buildDeps({}, { isTelemetryEnabled: false });
    const action = jest.fn().mockResolvedValue(undefined);

    await runChapterMutation("thu-1", "capPlus", action, deps);

    expect(beginChapterAction).toHaveBeenCalledWith("capPlus", {
      isTelemetryEnabled: false,
    });
    expect(action).toHaveBeenCalledWith("thu-1", mockActionContext);
  });

  it("clears the lock through the state setter, not only the ref", async () => {
    const { deps, setIsMutatingAnimeById } = buildDeps();

    await runChapterMutation("thu-1", "capPlus", jest.fn().mockResolvedValue(undefined), deps);

    expect(setIsMutatingAnimeById).toHaveBeenNthCalledWith(1, { "thu-1": true });
    expect(setIsMutatingAnimeById).toHaveBeenLastCalledWith({});
  });
});
