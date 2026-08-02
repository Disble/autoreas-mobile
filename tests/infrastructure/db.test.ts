import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import {
  clearBridgeConfig,
  openAppDatabaseSync,
  runMigrations,
  withDeferredWrite,
  withExclusiveWrite,
} from "../../src/infrastructure/db/client";
import { ensureMissingColumns } from "../../src/infrastructure/db/client/client.helpers";
import { bridgeConfig } from "../../src/infrastructure/db/schema";
import * as nativeRuntime from "../../src/infrastructure/db/native-runtime/native-runtime.helpers";

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(
    (client: {
      __state?: {
        animes: Record<string, unknown>[];
        deletes?: unknown[];
      };
    }) => ({
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          client.__state?.animes.push(value);
        },
      }),
      delete: async (table: unknown) => {
        client.__state?.deletes?.push(table);
      },
      select: () => ({
        from: () => client.__state?.animes ?? [],
      }),
    }),
  ),
}));

jest.mock("drizzle-orm/expo-sqlite/migrator", () => ({
  migrate: jest.fn(),
}));

jest.mock("../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
  getDrizzleFactory: jest.fn(),
  getDrizzleMigrator: jest.fn(),
  getOpenDatabaseSync: jest.fn(),
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
        { idx: 4, tag: "0004_add_foreground_sync_diagnostics" },
        { idx: 5, tag: "0005_add_operation_log_retention_support" },
        { idx: 6, tag: "0006_sanitize_bridge_config_changelog_cursor" },
      ],
    },
    migrations: {
      m0000: "CREATE TABLE `bridge_config` (`id` integer PRIMARY KEY DEFAULT 1 NOT NULL);",
      m0001: "ALTER TABLE `bridge_config` ADD COLUMN `last_changelog_id` integer DEFAULT 0;",
      m0002:
        "CREATE TABLE `sync_runtime_status` (`id` integer PRIMARY KEY DEFAULT 1 NOT NULL, `registration_status` text DEFAULT 'unregistered' NOT NULL, `last_attempt_at` integer, `last_success_at` integer, `last_failure_message` text, `last_trigger_source` text);",
      m0003:
        "ALTER TABLE `sync_runtime_status` ADD COLUMN `execution_mode` text DEFAULT 'best_effort_background_task' NOT NULL;",
      m0004:
        "ALTER TABLE `sync_runtime_status` ADD COLUMN `foreground_service_callback_started_at` integer;",
      m0005:
        "ALTER TABLE `sync_runtime_status` ADD COLUMN `is_cycle_active` integer DEFAULT false NOT NULL;",
      m0006:
        "UPDATE `bridge_config` SET `last_changelog_id` = 0 WHERE `last_changelog_id` > 1000000000000 OR `last_changelog_id` < 0;",
    },
  },
}));

describe("db client tracer helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("openAppDatabaseSync mantiene el comportamiento por defecto para UI", () => {
    const openDatabaseSync = jest.fn().mockReturnValue({ id: "raw-db" });
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(openDatabaseSync);

    const rawDb = openAppDatabaseSync();

    expect(rawDb).toEqual({ id: "raw-db" });
    expect(openDatabaseSync).toHaveBeenCalledWith("autoreas.db", {
      enableChangeListener: true,
      useNewConnection: false,
    });
  });

  it("openAppDatabaseSync acepta overrides opcionales para runtimes dedicados", () => {
    const openDatabaseSync = jest.fn().mockReturnValue({ id: "raw-db" });
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(openDatabaseSync);

    openAppDatabaseSync({
      enableChangeListener: false,
      useNewConnection: true,
    });

    expect(openDatabaseSync).toHaveBeenCalledWith("autoreas.db", {
      enableChangeListener: false,
      useNewConnection: true,
    });
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
            expect.objectContaining({ tag: "0004_add_foreground_sync_diagnostics" }),
            expect.objectContaining({ tag: "0005_add_operation_log_retention_support" }),
            expect.objectContaining({ tag: "0006_sanitize_bridge_config_changelog_cursor" }),
          ]),
        }),
        migrations: expect.objectContaining({
          m0001: expect.stringContaining('ALTER TABLE `bridge_config` ADD COLUMN `last_changelog_id` integer DEFAULT 0;'),
          m0002: expect.stringContaining('CREATE TABLE `sync_runtime_status`'),
          m0003: expect.stringContaining('ALTER TABLE `sync_runtime_status` ADD COLUMN `execution_mode`'),
          m0004: expect.stringContaining('ALTER TABLE `sync_runtime_status` ADD COLUMN `foreground_service_callback_started_at`'),
          m0005: expect.stringContaining('ALTER TABLE `sync_runtime_status` ADD COLUMN `is_cycle_active`'),
          m0006: expect.stringContaining('UPDATE `bridge_config` SET `last_changelog_id` = 0'),
        }),
      })
    );
  });

  it("aplica solamente las columnas ausentes y conserva el orden declarado", async () => {
    const rawDb = {
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await ensureMissingColumns(
      rawDb as never,
      new Set(["already_present"]),
      [
        { columnName: "first_missing", sql: "ALTER first" },
        { columnName: "already_present", sql: "ALTER existing" },
        { columnName: "second_missing", sql: "ALTER second" },
      ],
    );

    expect(rawDb.runAsync.mock.calls).toEqual([
      ["ALTER first"],
      ["ALTER second"],
    ]);
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
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE bridge_config ADD COLUMN last_changelog_id INTEGER DEFAULT 0"
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0 OR last_changelog_id > 1000000000000"
    );
  });

  it("no altera bridge_config cuando last_changelog_id ya existe", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(bridge_config)") {
          return [{ name: "id" }, { name: "last_changelog_id" }];
        }

        if (query === "PRAGMA table_info(sync_runtime_status)") {
          return [
            { name: "id" },
            { name: "registration_status" },
            { name: "execution_mode" },
            { name: "is_foreground_service_running" },
            { name: "can_show_persistent_notification" },
            { name: "last_attempt_at" },
            { name: "last_success_at" },
            { name: "last_failure_message" },
            { name: "last_trigger_source" },
            { name: "last_synced_count" },
            { name: "foreground_service_callback_started_at" },
            { name: "last_no_op_reason" },
            { name: "last_pending_operations_count_at_start" },
            { name: "is_cycle_active" },
            { name: "last_backlog_read_count" },
            { name: "last_pruned_operations_count" },
            { name: "is_background_task_registered" },
          ];
        }

        if (query === "PRAGMA table_info(animes)") {
          return [{ name: "_id" }, { name: "last_applied_change_ms" }];
        }

        return [];
      }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledTimes(7);
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0 OR last_changelog_id > 1000000000000"
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS operation_log_status_created_at_idx ON operation_log(status, created_at, id)'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE TABLE IF NOT EXISTS pending_remote_changes (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'record_id TEXT NOT NULL, ' +
        'change_type TEXT NOT NULL, ' +
        'changed_fields TEXT NOT NULL, ' +
        'snapshot TEXT, ' +
        'timestamp INTEGER NOT NULL, ' +
        'created_at INTEGER NOT NULL)'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE TABLE IF NOT EXISTS season_rating_queue (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'season_id TEXT NOT NULL, ' +
        'anime_id TEXT NOT NULL, ' +
        'nota INTEGER NOT NULL, ' +
        'rated_at INTEGER NOT NULL, ' +
        "status TEXT NOT NULL DEFAULT 'pending', " +
        'created_at INTEGER NOT NULL, ' +
        'updated_at INTEGER NOT NULL, ' +
        'last_attempt_at INTEGER, ' +
        'last_failure_kind TEXT)'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS season_rating_queue_status_created_at_idx ON season_rating_queue(status, created_at, id)'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE TABLE IF NOT EXISTS active_season_cache (' +
        'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
        'season_id TEXT NOT NULL, ' +
        'candidates_json TEXT NOT NULL)'
    );
  });

  it("repara sync_runtime_status legacy agregando columnas del execution mode", async () => {
    const rawDb = {
      getAllAsync: jest
        .fn()
        .mockImplementation(async (query: string) => {
          if (query === "PRAGMA table_info(bridge_config)") {
            return [{ name: "id" }, { name: "last_changelog_id" }];
          }

          if (query === "PRAGMA table_info(sync_runtime_status)") {
            return [
              { name: "id" },
              { name: "registration_status" },
              { name: "last_attempt_at" },
              { name: "last_success_at" },
              { name: "last_failure_message" },
              { name: "last_trigger_source" },
              { name: "last_synced_count" },
            ];
          }

          return [];
        }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(sync_runtime_status)");
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL"
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN is_foreground_service_running INTEGER DEFAULT 0 NOT NULL"
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL"
    );
  });

  it("repara sync_runtime_status legacy agregando columnas de diagnostics y retention", async () => {
    const rawDb = {
      getAllAsync: jest
        .fn()
        .mockImplementation(async (query: string) => {
          if (query === "PRAGMA table_info(bridge_config)") {
            return [{ name: "id" }, { name: "last_changelog_id" }];
          }

          if (query === "PRAGMA table_info(sync_runtime_status)") {
            return [
              { name: "id" },
              { name: "registration_status" },
              { name: "execution_mode" },
              { name: "is_foreground_service_running" },
              { name: "can_show_persistent_notification" },
              { name: "last_attempt_at" },
              { name: "last_success_at" },
              { name: "last_failure_message" },
              { name: "last_trigger_source" },
              { name: "last_synced_count" },
            ];
          }

          return [];
        }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN foreground_service_callback_started_at INTEGER'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_no_op_reason TEXT'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_pending_operations_count_at_start INTEGER'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN is_cycle_active INTEGER DEFAULT 0 NOT NULL'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_backlog_read_count INTEGER DEFAULT 0 NOT NULL'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_pruned_operations_count INTEGER DEFAULT 0 NOT NULL'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN is_background_task_registered INTEGER DEFAULT 0 NOT NULL'
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS operation_log_status_created_at_idx ON operation_log(status, created_at, id)'
    );
  });

  it("la migración 0006 sanea cursores de changelog corrompidos con timestamps", async () => {
    const rawDb = {
      runAsync: jest.fn().mockResolvedValue({ changes: 1 }),
    };

    await rawDb.runAsync(
      "UPDATE `bridge_config` SET `last_changelog_id` = 0 WHERE `last_changelog_id` > 1000000000000 OR `last_changelog_id` < 0;"
    );

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE `bridge_config` SET `last_changelog_id` = 0")
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("`last_changelog_id` > 1000000000000")
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("`last_changelog_id` < 0")
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

  it("clearBridgeConfig usa el write diferido y borra bridge_config sin runAsync directo", async () => {
    const rawDb = {
      __state: {
        animes: [] as Record<string, unknown>[],
        deletes: [] as unknown[],
      },
      runAsync: jest.fn(),
      withTransactionAsync: jest.fn(async (task: () => Promise<void>) => {
        await task();
      }),
    };

    await clearBridgeConfig(rawDb as never);

    expect(rawDb.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(rawDb.__state.deletes).toEqual([bridgeConfig]);
    expect(rawDb.runAsync).not.toHaveBeenCalled();
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
