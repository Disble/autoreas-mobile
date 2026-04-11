import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import {
  runMigrations,
  withDeferredWrite,
  withExclusiveWrite,
} from "../../src/infrastructure/db/client";

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(
    (client: { __state?: { animes: Record<string, unknown>[] } }) => ({
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          client.__state?.animes.push(value);
        },
      }),
      select: () => ({
        from: () => client.__state?.animes ?? [],
      }),
    }),
  ),
}));

jest.mock("drizzle-orm/expo-sqlite/migrator", () => ({
  migrate: jest.fn(),
}));

jest.mock("../../src/infrastructure/db/migrations/migrations", () => ({
  __esModule: true,
  default: {
    journal: {
      entries: [
        { idx: 0, tag: "0000_moaning_maximus" },
        { idx: 1, tag: "0001_add_bridge_config_last_changelog_id" },
        { idx: 2, tag: "0002_add_sync_runtime_status" },
        { idx: 3, tag: "0003_add_sync_execution_mode" },
      ],
    },
    migrations: {
      m0000: "CREATE TABLE `bridge_config` (`id` integer PRIMARY KEY DEFAULT 1 NOT NULL);",
      m0001: "ALTER TABLE `bridge_config` ADD COLUMN `last_changelog_id` integer DEFAULT 0;",
      m0002:
        "CREATE TABLE `sync_runtime_status` (`id` integer PRIMARY KEY DEFAULT 1 NOT NULL, `registration_status` text DEFAULT 'unregistered' NOT NULL, `last_attempt_at` integer, `last_success_at` integer, `last_failure_message` text, `last_trigger_source` text);",
      m0003:
        "ALTER TABLE `sync_runtime_status` ADD COLUMN `execution_mode` text DEFAULT 'best_effort_background_task' NOT NULL;",
    },
  },
}));

describe("db client tracer helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runMigrations ejecuta el journal completo incluyendo la migración formal nueva", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([{ name: "id" }, { name: "last_changelog_id" }]),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        journal: expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ tag: "0001_add_bridge_config_last_changelog_id" }),
            expect.objectContaining({ tag: "0002_add_sync_runtime_status" }),
            expect.objectContaining({ tag: "0003_add_sync_execution_mode" }),
          ]),
        }),
        migrations: expect.objectContaining({
          m0001: expect.stringContaining('ALTER TABLE `bridge_config` ADD COLUMN `last_changelog_id` integer DEFAULT 0;'),
          m0002: expect.stringContaining('CREATE TABLE `sync_runtime_status`'),
          m0003: expect.stringContaining('ALTER TABLE `sync_runtime_status` ADD COLUMN `execution_mode`'),
        }),
      })
    );
  });

  it("repara bridge_config legacy agregando last_changelog_id y sanea valores inválidos", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([
        { name: "id" },
        { name: "ip" },
        { name: "port" },
        { name: "token" },
        { name: "device_id" },
        { name: "device_name" },
      ]),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(bridge_config)");
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE bridge_config ADD COLUMN last_changelog_id INTEGER DEFAULT 0"
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0"
    );
  });

  it("no altera bridge_config cuando last_changelog_id ya existe", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([
        { name: "id" },
        { name: "last_changelog_id" },
      ]),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledTimes(1);
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0"
    );
  });

  it("devuelve el resultado del callback exclusivo", async () => {
    const rawDb = {
      __state: { animes: [] as Record<string, unknown>[] },
      withExclusiveTransactionAsync: jest.fn(
        async (task: (tx: unknown) => Promise<void>) => {
          await task(rawDb);
        },
      ),
    };

    const result = await withExclusiveWrite(rawDb as never, async () => "ok");

    expect(result).toBe("ok");
    expect(rawDb.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("serializa writes concurrentes sobre la misma db", async () => {
    const executionOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const rawDb = {
      withExclusiveTransactionAsync: jest.fn(
        async (task: (tx: unknown) => Promise<void>) => {
          executionOrder.push("start");
          await task(rawDb);
          executionOrder.push("end");
        },
      ),
    };

    const firstWrite = withExclusiveWrite(rawDb as never, async () => {
      executionOrder.push("task-1");
      await firstDone;
      executionOrder.push("task-1-done");
      return "first";
    });

    const secondWrite = withExclusiveWrite(rawDb as never, async () => {
      executionOrder.push("task-2");
      return "second";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executionOrder).toEqual(["start", "task-1"]);

    releaseFirst();

    await expect(firstWrite).resolves.toBe("first");
    await expect(secondWrite).resolves.toBe("second");
    expect(executionOrder).toEqual([
      "start",
      "task-1",
      "task-1-done",
      "end",
      "start",
      "task-2",
      "end",
    ]);
  });

  it("devuelve el resultado del callback diferido", async () => {
    const rawDb = {
      withTransactionAsync: jest.fn(async (task: () => Promise<void>) => {
        await task();
      }),
    };

    const result = await withDeferredWrite(rawDb as never, async () => "ok");

    expect(result).toBe("ok");
    expect(rawDb.withTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it("serializa writes diferidos concurrentes sobre la misma db", async () => {
    const executionOrder: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const rawDb = {
      withTransactionAsync: jest.fn(async (task: () => Promise<void>) => {
        executionOrder.push("start");
        await task();
        executionOrder.push("end");
      }),
    };

    const firstWrite = withDeferredWrite(rawDb as never, async () => {
      executionOrder.push("task-1");
      await firstDone;
      executionOrder.push("task-1-done");
      return "first";
    });

    const secondWrite = withDeferredWrite(rawDb as never, async () => {
      executionOrder.push("task-2");
      return "second";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executionOrder).toEqual(["start", "task-1"]);

    releaseFirst();

    await expect(firstWrite).resolves.toBe("first");
    await expect(secondWrite).resolves.toBe("second");
    expect(executionOrder).toEqual([
      "start",
      "task-1",
      "task-1-done",
      "end",
      "start",
      "task-2",
      "end",
    ]);
  });
});
