import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import journal from "../../../src/infrastructure/db/migrations/meta/_journal.json";
import { runMigrations } from "../../../src/infrastructure/db/client";
import { resolveMigrationLedgerTimestamp } from "../../../src/infrastructure/db/client/client.helpers";
import {
  MAX_JOURNAL_MIGRATION_TIMESTAMP_MS,
  MIGRATION_JOURNAL_TIMESTAMPS_MS,
} from "../../../src/infrastructure/db/client/client.constants";
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

/** Directory holding the real migration SQL this suite replays, never a hand-written copy. */
const MIGRATIONS_DIRECTORY = join(__dirname, "../../../src/infrastructure/db/migrations");

/** Journal entries in the exact order the drizzle migrator applies and records them. */
const JOURNAL_ENTRIES = [...journal.entries].sort((left, right) => left.idx - right.idx);

/** Journal index of the newest migration that shipped in the release before `0013`. */
const PREVIOUS_RELEASE_JOURNAL_INDEX = 12;

/** Journal index of the migration whose hand-typed future `when` poisoned the gate (H0Xx). */
const POISONED_JOURNAL_INDEX = 6;

/**
 * The value `0006` actually stored on poisoned devices: its original hand-typed `when`
 * (2026-09-20), higher than every real journal entry and therefore impossible to have been
 * written by any current journal.
 */
const POISONED_CREATED_AT_MS = 1_789_862_400_000;

/**
 * The clamp target the previous repair step used: migration `0010`'s own `when`. Devices bricked
 * by that step carry it on every ledger row recorded after `0010`.
 */
const PREVIOUS_CLAMP_TARGET_MS = 1_788_546_067_501;

/** One row of the migrator's `__drizzle_migrations` ledger. */
type LedgerRow = { rowid: number; created_at: number };

/** Reads one migration file and splits it into the statements the migrator would execute. */
function readMigrationStatements(tag: string): readonly string[] {
  return readFileSync(join(MIGRATIONS_DIRECTORY, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

/**
 * Builds an in-memory stand-in for the SQLite connection that models only the two facts this bug
 * turns on: what `__drizzle_migrations` holds, and that `ALTER TABLE ... ADD COLUMN` fails when
 * the column already exists. Everything else is a tolerated no-op.
 */
function createFakeDatabase() {
  let ledger: LedgerRow[] | null = null;
  const columnsByTable = new Map<string, Set<string>>();
  const appliedTags: string[] = [];

  const columnsOf = (table: string) => {
    const existing = columnsByTable.get(table);

    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    columnsByTable.set(table, created);
    return created;
  };

  const runAsync = jest.fn(async (sql: string, ...params: readonly unknown[]) => {
    const alter = /^ALTER TABLE `?(\w+)`? ADD (?:COLUMN )?`?(\w+)`?/.exec(sql.trim());

    if (alter) {
      const [, table, column] = alter;
      const tableColumns = columnsOf(table);

      if (tableColumns.has(column)) {
        throw new Error(`Error code 1: duplicate column name: ${column}`);
      }

      tableColumns.add(column);
      return { changes: 1 };
    }

    if (sql.startsWith("UPDATE __drizzle_migrations")) {
      const [createdAt, rowid] = params as readonly [number, number];
      const row = ledger?.find((candidate) => candidate.rowid === rowid);

      if (row) {
        row.created_at = createdAt;
      }

      return { changes: row ? 1 : 0 };
    }

    return { changes: 0 };
  });

  const getAllAsync = jest.fn(async (sql: string) => {
    const tableInfo = /^PRAGMA table_info\((\w+)\)$/.exec(sql.trim());

    if (tableInfo) {
      return [...columnsOf(tableInfo[1])].map((name) => ({ name }));
    }

    if (sql.includes("FROM __drizzle_migrations")) {
      if (!ledger) {
        throw new Error("Error code 1: no such table: __drizzle_migrations");
      }

      return ledger.map((row) => ({ ...row }));
    }

    return [];
  });

  const getFirstAsync = jest.fn(async (sql: string) => {
    if (sql.includes("sqlite_master") && sql.includes("__drizzle_migrations")) {
      return ledger ? { name: "__drizzle_migrations" } : null;
    }

    return null;
  });

  /**
   * Replays drizzle's own gate (`drizzle-orm/sqlite-core/dialect.cjs` `migrate()`): the newest
   * stored `created_at` is read ONCE before the loop, and every journal entry whose `when` clears
   * that single scalar is executed and recorded.
   */
  const applyPendingMigrations = async () => {
    ledger ??= [];
    const newestStored =
      ledger.length > 0 ? Math.max(...ledger.map((row) => Number(row.created_at))) : null;

    for (const entry of JOURNAL_ENTRIES) {
      if (newestStored !== null && newestStored >= entry.when) {
        continue;
      }

      for (const statement of readMigrationStatements(entry.tag)) {
        await runAsync(statement);
      }

      appliedTags.push(entry.tag);
      ledger.push({ rowid: ledger.length + 1, created_at: entry.when });
    }
  };

  /** Leaves the fake in the state a device carries after installing the release through `index`. */
  const seedThroughJournalIndex = async (index: number) => {
    ledger ??= [];

    for (const entry of JOURNAL_ENTRIES.slice(0, index + 1)) {
      for (const statement of readMigrationStatements(entry.tag)) {
        await runAsync(statement);
      }

      ledger.push({ rowid: ledger.length + 1, created_at: entry.when });
    }
  };

  /** Applies the previous repair step's clamp, which is what bricked already-upgraded devices. */
  const applyPreviousClamp = () => {
    for (const row of ledger ?? []) {
      if (row.created_at > PREVIOUS_CLAMP_TARGET_MS) {
        row.created_at = PREVIOUS_CLAMP_TARGET_MS;
      }
    }
  };

  /** Overwrites one ledger row, reproducing a device that stored a poisoned `created_at`. */
  const poisonLedgerRow = (index: number, createdAt: number) => {
    const row = ledger?.[index];

    if (row) {
      row.created_at = createdAt;
    }
  };

  return {
    appliedTags,
    applyPendingMigrations,
    applyPreviousClamp,
    getAllAsync,
    getFirstAsync,
    poisonLedgerRow,
    readLedger: () => (ledger ?? []).map((row) => ({ ...row })),
    runAsync,
    seedThroughJournalIndex,
  };
}

/**
 * `runMigrations` must never let drizzle's migrator re-execute a migration the device already
 * applied. The migrator gates on ONE scalar -- the highest `created_at` stored in
 * `__drizzle_migrations` -- so any repair step that drags a stored row backwards makes every
 * later migration run a second time, and `ALTER TABLE ... ADD COLUMN` is not idempotent: the
 * second run aborts the whole migration transaction with `duplicate column name`, which surfaces
 * as the `database_preparation` startup failure and bricks the app on every launch.
 */
describe("migration ledger reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
  });

  it("applies only the new migration when a device upgrades from the previous release", async () => {
    const fake = createFakeDatabase();
    await fake.seedThroughJournalIndex(PREVIOUS_RELEASE_JOURNAL_INDEX);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([JOURNAL_ENTRIES[PREVIOUS_RELEASE_JOURNAL_INDEX + 1].tag]);
    expect(fake.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE __drizzle_migrations"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("recovers a device whose ledger the previous clamp already dragged backwards", async () => {
    const fake = createFakeDatabase();
    await fake.seedThroughJournalIndex(PREVIOUS_RELEASE_JOURNAL_INDEX);
    fake.applyPreviousClamp();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([JOURNAL_ENTRIES[PREVIOUS_RELEASE_JOURNAL_INDEX + 1].tag]);
  });

  it("keeps a poisoned 0006 gate from re-running migrations the repair steps already cover", async () => {
    const fake = createFakeDatabase();
    await fake.seedThroughJournalIndex(POISONED_JOURNAL_INDEX);
    fake.poisonLedgerRow(POISONED_JOURNAL_INDEX, POISONED_CREATED_AT_MS);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
  });

  it("stays green on the launch after a poisoned device has already been repaired", async () => {
    const fake = createFakeDatabase();
    await fake.seedThroughJournalIndex(POISONED_JOURNAL_INDEX);
    fake.poisonLedgerRow(POISONED_JOURNAL_INDEX, POISONED_CREATED_AT_MS);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await runMigrations(fake as never);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();
    expect(fake.appliedTags).toEqual([]);
  });

  it("applies every migration on a fresh install with no ledger yet", async () => {
    const fake = createFakeDatabase();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual(JOURNAL_ENTRIES.map((entry) => entry.tag));
  });

  it("never touches the ledger on a fresh install where the table does not exist yet", async () => {
    const fake = createFakeDatabase();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await runMigrations(fake as never);

    expect(fake.runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE __drizzle_migrations"),
      expect.anything(),
      expect.anything(),
    );
  });
});

/**
 * The pure decision behind the repair. It may only ever RAISE a stored value to the journal `when`
 * of the migration that ledger position records, and may only lower a value that no current
 * journal could have produced -- lowering anything else is exactly what bricked the release.
 */
describe("resolveMigrationLedgerTimestamp", () => {
  it("leaves a row that already matches its journal entry untouched", () => {
    expect(resolveMigrationLedgerTimestamp(3, MIGRATION_JOURNAL_TIMESTAMPS_MS[3])).toBe(
      MIGRATION_JOURNAL_TIMESTAMPS_MS[3],
    );
  });

  it("raises a row a previous clamp dragged below its journal entry", () => {
    expect(resolveMigrationLedgerTimestamp(11, PREVIOUS_CLAMP_TARGET_MS)).toBe(
      MIGRATION_JOURNAL_TIMESTAMPS_MS[11],
    );
  });

  it("pins a value no current journal could have produced to the journal maximum", () => {
    expect(resolveMigrationLedgerTimestamp(POISONED_JOURNAL_INDEX, POISONED_CREATED_AT_MS)).toBe(
      MAX_JOURNAL_MIGRATION_TIMESTAMP_MS,
    );
  });

  it("never lowers a row that already sits above its own journal entry", () => {
    expect(
      resolveMigrationLedgerTimestamp(POISONED_JOURNAL_INDEX, MAX_JOURNAL_MIGRATION_TIMESTAMP_MS),
    ).toBe(MAX_JOURNAL_MIGRATION_TIMESTAMP_MS);
  });

  it("leaves a row with no journal entry of its own untouched", () => {
    expect(resolveMigrationLedgerTimestamp(JOURNAL_ENTRIES.length, PREVIOUS_CLAMP_TARGET_MS)).toBe(
      PREVIOUS_CLAMP_TARGET_MS,
    );
  });
});
