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
 * Migration 0010 also added `bridge_config.is_sync_telemetry_enabled`. Any device stalled on the
 * poisoned 0006 gate never applied it, and it carries no idempotent `ensure*` twin, so this repair
 * step is the only path back to a healed schema without rebuilding the journal.
 */
describe("ensureBridgeConfigLastChangelogId telemetry backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  function buildRawDb(existingBridgeConfigColumns: string[]) {
    return {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(bridge_config)") {
          return existingBridgeConfigColumns.map((name) => ({ name }));
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };
  }

  it("adds is_sync_telemetry_enabled with a numeric SQLite default when it predates 0010", async () => {
    const rawDb = buildRawDb(["id", "ip", "port", "token", "last_changelog_id"]);

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE bridge_config ADD COLUMN is_sync_telemetry_enabled INTEGER DEFAULT 1 NOT NULL",
    );
  });

  it("is idempotent: adds nothing when is_sync_telemetry_enabled already exists", async () => {
    const rawDb = buildRawDb([
      "id",
      "ip",
      "port",
      "token",
      "last_changelog_id",
      "is_sync_telemetry_enabled",
    ]);

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("is_sync_telemetry_enabled"),
    );
  });
});
