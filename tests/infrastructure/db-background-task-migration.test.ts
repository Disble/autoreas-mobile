import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../src/infrastructure/db/client";
import * as nativeRuntime from "../../src/infrastructure/db/native-runtime/native-runtime.helpers";
import { DEAD_SYNC_RUNTIME_STATUS_COLUMNS } from "../../src/infrastructure/db/client/sync-runtime-status-column-drop.constants";

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

/**
 * `sync_runtime_status` as a device stamped 20 holds it: the nine kept columns and every column
 * migration `0020` retires, so the repair pipeline both keeps and drops.
 */
const SYNC_RUNTIME_STATUS_COLUMNS = [
  "id",
  "registration_status",
  "execution_mode",
  "can_show_persistent_notification",
  "last_attempt_at",
  "last_success_at",
  "last_cycle_id",
  "last_cycle_stage",
  "last_error_name",
  ...DEAD_SYNC_RUNTIME_STATUS_COLUMNS,
].map((name) => ({ name }));

/** A promise this test can resolve or reject from outside its own executor. */
interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

/** Builds a `DeferredPromise` so a test can hold one repair step pending mid-pipeline. */
function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: DeferredPromise<T>["resolve"];
  let reject!: DeferredPromise<T>["reject"];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

/** Builds a mock `rawDb` with a caller-supplied `sync_runtime_status` column set. */
function createRawDb(syncRuntimeStatusColumns: { name: string }[]) {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockImplementation(async (query: string) => {
      if (query === "PRAGMA table_info(bridge_config)") {
        return [
          { name: "id" },
          { name: "last_changelog_id" },
          { name: "is_sync_telemetry_enabled" },
        ];
      }

      if (query === "PRAGMA table_info(sync_runtime_status)") {
        return syncRuntimeStatusColumns;
      }

      if (query === "PRAGMA table_info(animes)") {
        return [{ name: "_id" }, { name: "last_applied_change_ms" }];
      }

      return [];
    }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  };
}

describe("legacy schema repair writer order", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("runs legacy schema repairs in deterministic writer order", async () => {
    const firstRepair = createDeferredPromise<{ changes: number }>();
    const rawDb = createRawDb(SYNC_RUNTIME_STATUS_COLUMNS);
    rawDb.runAsync.mockImplementation((statement: string) => {
      if (statement.startsWith("UPDATE bridge_config")) {
        return firstRepair.promise;
      }

      return Promise.resolve({ changes: 0 });
    });

    const preparation = runMigrations(rawDb as never);
    // `clampPoisonedMigrationTimestamp` (Fix 2) awaits `getFirstAsync` before `migrate()` now
    // runs, adding one more microtask hop ahead of the first `runAsync` call this test observes --
    // flushing extra ticks is safe either way, because the whole pipeline stays blocked on
    // `firstRepair` regardless of how many ticks are flushed before it resolves.
    for (let tick = 0; tick < 6; tick += 1) {
      await Promise.resolve();
    }

    expect(rawDb.runAsync).toHaveBeenCalledTimes(1);

    firstRepair.resolve({ changes: 0 });
    await preparation;

    expect(rawDb.execAsync.mock.calls).toEqual([["BEGIN EXCLUSIVE"], ["COMMIT"]]);
    expect(rawDb.runAsync.mock.calls.map(([statement]) => statement)).toEqual([
      expect.stringMatching(/^UPDATE bridge_config/),
      'ALTER TABLE bridge_config ADD COLUMN season_mode INTEGER DEFAULT 0 NOT NULL',
      // The dead-column drop runs right after the sync_runtime_status column backfill (which has
      // nothing to add here) and before the operation_log index, one column at a time in order.
      ...DEAD_SYNC_RUNTIME_STATUS_COLUMNS.map((column) => `ALTER TABLE sync_runtime_status DROP COLUMN ${column}`),
      expect.stringMatching(/^CREATE INDEX IF NOT EXISTS operation_log/),
      expect.stringMatching(/^ALTER TABLE animes ADD COLUMN bridge_modified_at/),
      expect.stringMatching(/^ALTER TABLE animes ADD COLUMN episodes/),
      expect.stringMatching(/^ALTER TABLE animes ADD COLUMN folder_relative/),
      'ALTER TABLE animes ADD COLUMN season TEXT',
      expect.stringMatching(/^ALTER TABLE operation_log ADD COLUMN conflict_attempt_count/),
      'ALTER TABLE operation_log ADD COLUMN claim_owner TEXT',
      'ALTER TABLE operation_log ADD COLUMN claimed_at INTEGER',
      'ALTER TABLE operation_log ADD COLUMN unresolved_reason TEXT',
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS pending_remote_changes/),
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS active_season_cache/),
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS sync_cycle_lock/),
      expect.stringMatching(/^CREATE TABLE IF NOT EXISTS app_preferences/),
      'ALTER TABLE app_preferences ADD COLUMN anime_folders_root_uri TEXT',
      'ALTER TABLE app_preferences ADD COLUMN anime_folders_hint_dismissed_at INTEGER',
    ]);
  });

});
