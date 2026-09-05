import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { runMigrations } from "../../../src/infrastructure/db/client";
import { animes } from "../../../src/infrastructure/db/schema";
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

describe("ensureAnimesColumns (formerly ensureAnimesGuardColumn)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
  });

  it("agrega last_applied_change_ms cuando la columna no existe (NULL por defecto, sin backfill)", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [{ name: "_id" }, { name: "nombre" }, { name: "estado" }];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(animes)");
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER"
    );
  });

  it("es idempotente: no altera animes cuando last_applied_change_ms ya existe", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [
            { name: "_id" },
            { name: "nombre" },
            { name: "last_applied_change_ms" },
          ];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.getAllAsync).toHaveBeenCalledWith("PRAGMA table_info(animes)");
    expect(rawDb.runAsync).not.toHaveBeenCalledWith(
      "ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER"
    );
  });

  it("re-ejecutar runMigrations dos veces solo agrega la columna una vez", async () => {
    let hasGuardColumn = false;
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return hasGuardColumn
            ? [{ name: "_id" }, { name: "last_applied_change_ms" }]
            : [{ name: "_id" }];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockImplementation(async (sql: string) => {
        if (sql === "ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER") {
          hasGuardColumn = true;
        }

        return { changes: 0 };
      }),
    };

    await runMigrations(rawDb as never);
    await runMigrations(rawDb as never);

    const alterCalls = rawDb.runAsync.mock.calls.filter(
      ([sql]) => sql === "ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER"
    );

    expect(alterCalls).toHaveLength(1);
  });

  it("adds bridge_modified_at when missing, nullable with no default", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [
            { name: "_id" },
            { name: "nombre" },
            { name: "last_applied_change_ms" },
          ];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).toHaveBeenCalledWith(
      "ALTER TABLE animes ADD COLUMN bridge_modified_at INTEGER"
    );
  });

  it("is idempotent for bridge_modified_at when the column already exists", async () => {
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return [
            { name: "_id" },
            { name: "last_applied_change_ms" },
            { name: "bridge_modified_at" },
          ];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
    };

    await runMigrations(rawDb as never);

    expect(rawDb.runAsync).not.toHaveBeenCalledWith(
      "ALTER TABLE animes ADD COLUMN bridge_modified_at INTEGER"
    );
  });

  it("repairs a pre-0011 database whose migration history already reports 0011 applied but the column is absent, and is a no-op re-run on a current one", async () => {
    let hasTokenColumn = false;
    const rawDb = {
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === "PRAGMA table_info(animes)") {
          return hasTokenColumn
            ? [{ name: "_id" }, { name: "last_applied_change_ms" }, { name: "bridge_modified_at" }]
            : [{ name: "_id" }, { name: "last_applied_change_ms" }];
        }

        return [];
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      runAsync: jest.fn().mockImplementation(async (sql: string) => {
        if (sql === "ALTER TABLE animes ADD COLUMN bridge_modified_at INTEGER") {
          hasTokenColumn = true;
        }

        return { changes: 0 };
      }),
    };

    await runMigrations(rawDb as never);
    await runMigrations(rawDb as never);

    const alterCalls = rawDb.runAsync.mock.calls.filter(
      ([sql]) => sql === "ALTER TABLE animes ADD COLUMN bridge_modified_at INTEGER"
    );

    expect(alterCalls).toHaveLength(1);
  });

  it("declares bridge_modified_at with no default and no NOT NULL, so an inserted row with no explicit token reads back NULL, not a fabricated 0", () => {
    // A real 0 is a legitimate token (invariant 3), so this column must never silently default a
    // pre-existing or freshly inserted row to 0 -- it either carries a real value or stays NULL.
    const column = animes.bridgeModifiedAt;

    expect(column.hasDefault).toBe(false);
    expect(column.notNull).toBe(false);
  });
});
