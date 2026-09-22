jest.mock("expo-background-task", () => ({
  BackgroundTaskResult: {
    Failed: "failed-result",
    Success: "success-result",
  },
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
}));

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

jest.mock("../../../src/features/sync/background-sync.helpers", () => ({
  runBackgroundSyncCycle: jest.fn(),
  // Mirrors the real contract rather than stubbing a fixed answer, so these cases keep asserting
  // what they always asserted: a cycle that resolves maps to Success, one that throws maps to
  // Failed. `resolveBackgroundTaskOutcome`'s own guarantees (it never hangs, never rejects) are
  // covered directly in background-sync-outcome.test.ts.
  resolveBackgroundTaskOutcome: jest.fn(
    async ({ runCycle }: { runCycle: () => Promise<unknown> }) => {
      try {
        await runCycle();
        return "success";
      } catch {
        return "failed";
      }
    },
  ),
}));

jest.mock("../../../src/features/sync/foreground-service-watchdog.helpers", () => ({
  // The watchdog's own never-throw contract (and the honest limits of its deadline on the
  // headless path) is covered directly in foreground-service-watchdog.helpers.test.ts; here it
  // only needs a controllable stand-in so these cases can assert the wiring: called every run,
  // and structurally unable to change the sync outcome even when it never settles at all --
  // that last case is the one this file exists to prove, since an awaited hang here would
  // reintroduce H06h's loop (see the wiring comment in background-sync.task.ts).
  runForegroundServiceWatchdog: jest.fn(),
}));

/** Returns the mocked `expo-background-task` module, whose enum values the task maps onto. */
function getBackgroundTaskModule() {
  return jest.requireMock("expo-background-task") as typeof import("expo-background-task");
}

/** Returns the mocked `expo-task-manager` module, used to capture the registered task. */
function getTaskManagerModule() {
  return jest.requireMock("expo-task-manager") as typeof import("expo-task-manager");
}

/** Returns the mocked background-sync helpers so a case can steer the cycle outcome. */
function getBackgroundSyncModule() {
  return jest.requireMock("../../../src/features/sync/background-sync.helpers") as typeof import("../../../src/features/sync/background-sync.helpers");
}

/** Returns the mocked FGS watchdog so a case can steer or assert its invocation. */
function getForegroundServiceWatchdogModule() {
  return jest.requireMock("../../../src/features/sync/foreground-service-watchdog.helpers") as typeof import("../../../src/features/sync/foreground-service-watchdog.helpers");
}

/** Loads the task module in isolation and returns the callback it registered with the host. */
function loadDefinedTask() {
  jest.isolateModules(() => {
    jest.requireActual("../../../src/features/sync/background-sync.task");
  });

  const taskManagerModule = getTaskManagerModule();

  expect(taskManagerModule.defineTask).toHaveBeenCalledWith(
    "autoreas-background-sync",
    expect.any(Function),
  );

  return (taskManagerModule.defineTask as jest.Mock).mock
    .calls[0][1] as () => Promise<string>;
}

describe("background sync task", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.resetModules();
    (
      getTaskManagerModule().isTaskRegisteredAsync as jest.Mock
    ).mockResolvedValue(false);
    (
      getForegroundServiceWatchdogModule().runForegroundServiceWatchdog as jest.Mock
    ).mockResolvedValue("already_running");
  });

  it("returns success when the background sync cycle records a handled failure", async () => {
    (
      getBackgroundSyncModule().runBackgroundSyncCycle as jest.Mock
    ).mockResolvedValue({
      kind: "failed",
      syncedCount: 0,
    });

    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(
      getBackgroundTaskModule().BackgroundTaskResult.Success,
    );
  });

  it("returns failed when the background task crashes unexpectedly", async () => {
    (
      getBackgroundSyncModule().runBackgroundSyncCycle as jest.Mock
    ).mockRejectedValue(new Error("Unexpected crash"));

    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(
      getBackgroundTaskModule().BackgroundTaskResult.Failed,
    );
  });

  it("rides the same headless wake to run the FGS watchdog after the sync cycle settles", async () => {
    (
      getBackgroundSyncModule().runBackgroundSyncCycle as jest.Mock
    ).mockResolvedValue({ kind: "success", syncedCount: 1 });

    const task = loadDefinedTask();

    await task();

    expect(
      getForegroundServiceWatchdogModule().runForegroundServiceWatchdog,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not let a rejecting watchdog change the reported sync outcome", async () => {
    (
      getBackgroundSyncModule().runBackgroundSyncCycle as jest.Mock
    ).mockResolvedValue({ kind: "success", syncedCount: 1 });
    (
      getForegroundServiceWatchdogModule().runForegroundServiceWatchdog as jest.Mock
    ).mockRejectedValue(new Error("watchdog exploded"));

    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(
      getBackgroundTaskModule().BackgroundTaskResult.Success,
    );
  });

  it("does not let a watchdog that never settles delay or change the reported sync outcome", async () => {
    // This is the load-bearing case: `adapter.register()` can hang forever on the headless path
    // (see the wiring comment in background-sync.task.ts), and JS-level deadlines cannot be
    // trusted to rescue that hang there. The only real guarantee is structural -- the task must
    // never await the watchdog -- and a permanently-pending promise is the one double that
    // actually exercises that guarantee: an awaited hang would make this test itself hang.
    (
      getBackgroundSyncModule().runBackgroundSyncCycle as jest.Mock
    ).mockResolvedValue({ kind: "success", syncedCount: 1 });
    (
      getForegroundServiceWatchdogModule().runForegroundServiceWatchdog as jest.Mock
    ).mockReturnValue(new Promise(() => undefined));

    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(
      getBackgroundTaskModule().BackgroundTaskResult.Success,
    );
  });
});
