import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../../src/infrastructure/db/client";
import { MIGRATION_0010_TIMESTAMP_MS } from "../../../src/infrastructure/db/client/client.constants";
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

/** Mirrors the `sqlite_master` existence check the repair step runs before touching anything. */
const MIGRATIONS_TABLE_LOOKUP_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'";

/** Mirrors the exact clamp statement `clampPoisonedMigrationTimestamp` is expected to issue. */
const CLAMP_SQL = `UPDATE __drizzle_migrations SET created_at = ${MIGRATION_0010_TIMESTAMP_MS} WHERE created_at > ${MIGRATION_0010_TIMESTAMP_MS}`;

/**
 * H0Xx: a hand-typed future `when` on migration 0006's journal entry (2026-09-20) got stored into
 * a device's `__drizzle_migrations.created_at`. Drizzle's migrator gates every later migration on
 * `created_at < folderMillis`, so once that poisoned value was stored, 0007-0010 were silently
 * skipped forever -- fixing the journal entry alone does nothing for a device that already has the
 * poisoned row. This repair step clamps it back down before `migrate()` runs.
 */
describe("clampPoisonedMigrationTimestamp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("clamps a stored timestamp past 0010 back down to 0010's own hardcoded when", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === MIGRATIONS_TABLE_LOOKUP_SQL) {
          return { name: "__drizzle_migrations" };
        }

        return null;
      }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(MIGRATIONS_TABLE_LOOKUP_SQL);
    expect(rawDb.runAsync).toHaveBeenCalledWith(CLAMP_SQL);
  });

  it("never touches __drizzle_migrations on a fresh install where the table does not exist yet", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getFirstAsync).toHaveBeenCalledWith(MIGRATIONS_TABLE_LOOKUP_SQL);
    expect(rawDb.runAsync).not.toHaveBeenCalledWith(CLAMP_SQL);
  });

  it("runs the clamp before the drizzle migrator so the gate is already healed when migrate() reads it", async () => {
    const order: string[] = [];
    const rawDb = {
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === MIGRATIONS_TABLE_LOOKUP_SQL) {
          return { name: "__drizzle_migrations" };
        }

        return null;
      }),
      runAsync: jest.fn().mockImplementation(async (sql: string) => {
        if (sql === CLAMP_SQL) order.push("clamp");
        return { changes: 0 };
      }),
    };
    (migrate as jest.Mock).mockImplementationOnce(async () => {
      order.push("migrate");
    });

    await runMigrations(rawDb as never);

    expect(order).toEqual(["clamp", "migrate"]);
  });

  it("hardcodes the clamp target to 0010's own when instead of deriving it from the journal maximum", () => {
    // Deriving the clamp from max(journal.entries[].when) would keep rising with every new
    // migration added after this fix, and the clamp would then poison the NEXT migration the same
    // way 0006 poisoned this one -- clamping it down before it ever got a chance to run.
    expect(MIGRATION_0010_TIMESTAMP_MS).toBe(1788546067501);
  });
});
