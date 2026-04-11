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
}));

function getBackgroundTaskModule() {
  return require("expo-background-task") as typeof import("expo-background-task");
}

function getTaskManagerModule() {
  return require("expo-task-manager") as typeof import("expo-task-manager");
}

function getBackgroundSyncModule() {
  return require("../../../src/features/sync/background-sync.helpers") as typeof import("../../../src/features/sync/background-sync.helpers");
}

function loadDefinedTask() {
  jest.isolateModules(() => {
    require("../../../src/features/sync/background-sync.task");
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
