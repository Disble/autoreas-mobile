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

const CREATE_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS pending_remote_changes (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
  "record_id TEXT NOT NULL, " +
  "change_type TEXT NOT NULL, " +
  "changed_fields TEXT NOT NULL, " +
  "snapshot TEXT, " +
  "timestamp INTEGER NOT NULL, " +
  "created_at INTEGER NOT NULL)";

describe("ensurePendingRemoteChangesTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("crea la tabla pending_remote_changes cuando no existe", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [{ name: "_id" }, { name: "last_applied_change_ms" }];
        }

        return [];
      }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledWith(CREATE_TABLE_SQL);
  });

  it("es idempotente: usar CREATE TABLE IF NOT EXISTS no falla en reruns", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [{ name: "_id" }, { name: "last_applied_change_ms" }];
        }

        return [];
      }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);
    await runMigrations(rawDb as never);

    const createCalls = rawDb.runAsync.mock.calls.filter(
      ([sql]) => sql === CREATE_TABLE_SQL,
    );

    expect(createCalls).toHaveLength(2);
    await expect(runMigrations(rawDb as never)).resolves.toBeDefined();
  });
});
