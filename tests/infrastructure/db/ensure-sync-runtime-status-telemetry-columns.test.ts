import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../../src/infrastructure/db/client";
import * as nativeRuntime from "../../../src/infrastructure/db/native-runtime/native-runtime.helpers";

jest.mock("drizzle-orm", () => ({
  desc: jest.fn((value) => value),
}));

jest.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: jest.fn(() => ({})),
}));

jest.mock("drizzle-orm/expo-sqlite/migrator", () => ({
  migrate: jest.fn(),
}));

jest.mock("../../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
  getDrizzleFactory: jest.fn(),
  getDrizzleMigrator: jest.fn(),
  getOpenDatabaseSync: jest.fn(),
}));

jest.mock("../../../src/infrastructure/db/migrations/migrations", () => ({
  __esModule: true,
  default: {
    journal: { entries: [] },
    migrations: {},
  },
}));

/**
 * Devices that already applied migration 0006 before its poisoned `when` (2026-09-20) was
 * discovered had every migration after it -- 0007 through 0010 -- silently skipped by drizzle's
 * gate. 0010's telemetry columns had no idempotent `ensure*` twin, so those devices are stuck with
 * a `sync_runtime_status` table missing all eight columns this repair step exists to backfill.
 */
describe("ensureSyncRuntimeStatusExecutionColumns telemetry backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  function buildRawDb(existingSyncRuntimeStatusColumns: string[]) {
    return {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(sync_runtime_status)") {
          return existingSyncRuntimeStatusColumns.map((name) => ({ name }));
        }

        if (query === "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'") {
          return [];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };
  }

  it("adds every skipped 0010 telemetry column when a device stalled on the poisoned 0006 gate", async () => {
    const rawDb = buildRawDb([
      "id",
      "registration_status",
      "execution_mode",
      "is_foreground_service_running",
      "can_show_persistent_notification",
      "last_attempt_at",
      "last_success_at",
      "last_failure_message",
      "last_trigger_source",
      "last_synced_count",
      "foreground_service_callback_started_at",
      "last_no_op_reason",
      "last_pending_operations_count_at_start",
      "is_cycle_active",
      "last_backlog_read_count",
      "last_pruned_operations_count",
      "is_background_task_registered",
    ]);

    await runMigrations(rawDb as never);

    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(sync_runtime_status)");
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_id TEXT",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_stage TEXT",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_error_name TEXT",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_native_errcode_byte INTEGER",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_error_stage TEXT",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN consecutive_unclosed_cycles INTEGER DEFAULT 0 NOT NULL",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_stage_at INTEGER",
    );
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE sync_runtime_status ADD COLUMN last_failed_checkpoint_count INTEGER DEFAULT 0 NOT NULL",
    );
  });

  it("is idempotent: adds nothing when every telemetry column already exists", async () => {
    const rawDb = buildRawDb([
      "id",
      "registration_status",
      "execution_mode",
      "is_foreground_service_running",
      "can_show_persistent_notification",
      "last_attempt_at",
      "last_success_at",
      "last_failure_message",
      "last_trigger_source",
      "last_synced_count",
      "foreground_service_callback_started_at",
      "last_no_op_reason",
      "last_pending_operations_count_at_start",
      "is_cycle_active",
      "last_backlog_read_count",
      "last_pruned_operations_count",
      "is_background_task_registered",
      "last_cycle_id",
      "last_cycle_stage",
      "last_error_name",
      "last_native_errcode_byte",
      "last_error_stage",
      "consecutive_unclosed_cycles",
      "last_cycle_stage_at",
      "last_failed_checkpoint_count",
    ]);

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("sync_runtime_status ADD COLUMN last_cycle_id"),
    );
  });
});
