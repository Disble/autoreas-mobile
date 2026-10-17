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
 * gate. Of 0010's columns only `last_cycle_id`, `last_cycle_stage` and `last_error_name` still have
 * a reader, so those three are backfilled; the dead ones (convergent-sync T18) are never re-added,
 * and the ones the device already carries are dropped.
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
      execAsync: jest.fn().mockResolvedValue(undefined),
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(sync_runtime_status)") {
          return existingSyncRuntimeStatusColumns.map((name) => ({ name }));
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };
  }

  /** Every `sync_runtime_status` statement `runAsync` received, in order. */
  function runStatements(rawDb: ReturnType<typeof buildRawDb>): string[] {
    return rawDb.runAsync.mock.calls
      .map(([statement]: [string]) => statement)
      .filter((statement) => statement.includes("sync_runtime_status"));
  }

  it("adds the three kept 0010 columns to a device stalled on the poisoned 0006 gate, and drops its dead ones", async () => {
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
    ]);

    await runMigrations(rawDb as never);

    expect(runStatements(rawDb)).toEqual([
      "ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_id TEXT",
      "ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_stage TEXT",
      "ALTER TABLE sync_runtime_status ADD COLUMN last_error_name TEXT",
      "ALTER TABLE sync_runtime_status DROP COLUMN is_foreground_service_running",
      "ALTER TABLE sync_runtime_status DROP COLUMN last_failure_message",
      "ALTER TABLE sync_runtime_status DROP COLUMN last_trigger_source",
      "ALTER TABLE sync_runtime_status DROP COLUMN last_synced_count",
    ]);
    expect(rawDb.execAsync.mock.calls).toEqual([["BEGIN EXCLUSIVE"], ["COMMIT"]]);
  });

  it("is idempotent: touches nothing when the table holds exactly the kept columns", async () => {
    const rawDb = buildRawDb([
      "id",
      "registration_status",
      "execution_mode",
      "can_show_persistent_notification",
      "last_attempt_at",
      "last_success_at",
      "last_cycle_id",
      "last_cycle_stage",
      "last_error_name",
    ]);

    await runMigrations(rawDb as never);

    expect(runStatements(rawDb)).toEqual([]);
    expect(rawDb.execAsync).not.toHaveBeenCalled();
  });
});
