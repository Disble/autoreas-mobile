import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../src/infrastructure/db/client";
import * as nativeRuntime from "../../src/infrastructure/db/native-runtime/native-runtime.helpers";

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(() => ({})),
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

const SYNC_RUNTIME_STATUS_BASE_COLUMNS = [
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
];

function createRawDb(syncRuntimeStatusColumns: { name: string }[]) {
  return {
    getAllAsync: jest.fn().mockImplementation(async (query: string) => {
      if (query === "PRAGMA table_info(bridge_config)") {
        return [{ name: "id" }, { name: "last_changelog_id" }];
      }

      if (query === "PRAGMA table_info(sync_runtime_status)") {
        return syncRuntimeStatusColumns;
      }

      if (query === "PRAGMA table_info(animes)") {
        return [{ name: "_id" }, { name: "last_applied_change_ms" }];
      }

      return [];
    }),
    runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  };
}

describe("sync_runtime_status is_background_task_registered migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("agrega is_background_task_registered de forma idempotente al re-ejecutar migraciones", async () => {
    const rawDb = createRawDb(SYNC_RUNTIME_STATUS_BASE_COLUMNS);

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      'ALTER TABLE sync_runtime_status ADD COLUMN is_background_task_registered INTEGER DEFAULT 0 NOT NULL'
    );

    const rawDbSecondRun = createRawDb([
      ...SYNC_RUNTIME_STATUS_BASE_COLUMNS,
      { name: "is_background_task_registered" },
    ]);

    await runMigrations(rawDbSecondRun as never);

    expect(rawDbSecondRun.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('is_background_task_registered')
    );
  });
});
