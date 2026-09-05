import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../../src/infrastructure/db/client";
import { operationLog } from "../../../src/infrastructure/db/schema";
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

describe("ensureOperationLogColumns (conflict_attempt_count)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("adds conflict_attempt_count when missing, NOT NULL with a default of 0", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(operation_log)") {
          return [{ name: "id" }, { name: "anime_id" }, { name: "status" }];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(operation_log)");
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE operation_log ADD COLUMN conflict_attempt_count INTEGER DEFAULT 0 NOT NULL",
    );
  });

  it("is idempotent: no-op re-run once conflict_attempt_count already exists", async () => {
    let hasConflictColumn = false;
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(operation_log)") {
          return hasConflictColumn
            ? [{ name: "id" }, { name: "conflict_attempt_count" }]
            : [{ name: "id" }];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockImplementation(async (sql: string) => {
        if (sql === "ALTER TABLE operation_log ADD COLUMN conflict_attempt_count INTEGER DEFAULT 0 NOT NULL") {
          hasConflictColumn = true;
        }

        return { changes: 0 };
      }),
    };

    await runMigrations(rawDb as never);
    await runMigrations(rawDb as never);

    const alterCalls = rawDb.runAsync.mock.calls.filter(
      ([sql]) => sql === "ALTER TABLE operation_log ADD COLUMN conflict_attempt_count INTEGER DEFAULT 0 NOT NULL",
    );

    expect(alterCalls).toHaveLength(1);
  });

  it("declares conflict_attempt_count NOT NULL with a default of 0, unlike the OCC token columns", () => {
    // Unlike `bridge_modified_at`/`last_applied_change_ms` (nullable, no default -- NULL carries
    // its own meaning), this counter is a per-row client-authored fact that must always have a
    // definite value: a freshly queued row has made zero conflict attempts, never "unknown".
    const column = operationLog.conflictAttemptCount;

    expect(column.notNull).toBe(true);
    expect(column.hasDefault).toBe(true);
  });
});
