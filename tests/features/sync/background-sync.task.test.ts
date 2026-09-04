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
});
