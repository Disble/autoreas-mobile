import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import journal from "../../../src/infrastructure/db/migrations/meta/_journal.json";
import { runMigrations } from "../../../src/infrastructure/db/client";
import { MAX_JOURNAL_MIGRATION_TIMESTAMP_MS } from "../../../src/infrastructure/db/client/client.constants";
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

/** `0006`'s original hand-typed `when` (2026-09-20), above every real journal entry. */
const POISONED_CREATED_AT_MS = 1_789_862_400_000;

/** Migration `0010`'s own `when`: the target the previous, defective clamp pinned rows to. */
const PREVIOUS_CLAMP_TARGET_MS = 1_788_546_067_501;

/** Matches the `ALTER TABLE ... ADD COLUMN` shape every migration and repair step emits. */
const ALTER_COLUMN_PATTERN = /^ALTER TABLE `?(\w+)`? ADD (?:COLUMN )?`?(\w+)`?/u;

/** Matches a `CREATE TABLE` and captures its body, so declared columns can be registered. */
const CREATE_TABLE_PATTERN = /^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(([\s\S]*)$/u;

/** Table-level constraint keywords a `CREATE TABLE` body carries instead of a column name. */
const TABLE_CONSTRAINT_KEYWORD = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/iu;

/** One row of the migrator's `__drizzle_migrations` ledger. */
type LedgerRow = { rowid: number; created_at: number };

/**
 * Chunks as drizzle reads them, reduced to the ONE statement expo actually executes.
 *
 * The migrator splits a file on `--> statement-breakpoint` and hands each chunk to expo's
 * `prepareSync`, which compiles a single statement and silently discards the tail. Migrations
 * 0003, 0004 and 0009 each pack several statements into one chunk, so their tails have never run
 * on any device — the repair steps are what actually created those columns.
 */
function readMigrationStatements(tag: string): readonly string[] {
  return readFileSync(join(MIGRATIONS_DIRECTORY, `${tag}.sql`), "utf8")
    .replace(/\r\n/gu, "\n")
    .split("--> statement-breakpoint")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => `${chunk.split(";")[0]};`);
}

/**
 * Builds an in-memory stand-in for the SQLite connection that models only the facts this defect
 * turns on: whether the application schema exists, what `__drizzle_migrations` holds, and that
 * `ALTER TABLE ... ADD COLUMN` fails when the column already exists.
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

  /** Applies one `ALTER TABLE ... ADD COLUMN`, refusing a duplicate exactly as SQLite does. */
  const applyAlter = (table: string, column: string) => {
    const tableColumns = columnsOf(table);

    if (tableColumns.has(column)) {
      throw new Error(`Error code 1: duplicate column name: ${column}`);
    }

    tableColumns.add(column);
    return { changes: 1 };
  };

  /** Registers the columns a `CREATE TABLE` body declares, ignoring table-level constraints. */
  const applyCreate = (table: string, body: string) => {
    const tableColumns = columnsOf(table);

    for (const line of body.split(",")) {
      const column = /`?(\w+)`?/u.exec(line.trim());

      if (column && !TABLE_CONSTRAINT_KEYWORD.test(column[1])) {
        tableColumns.add(column[1]);
      }
    }

    return { changes: 0 };
  };

  /** Rewrites every ledger row that does not already hold the pinned value. */
  const applyPin = (createdAt: number) => {
    let changes = 0;

    for (const row of ledger ?? []) {
      if (row.created_at !== createdAt) {
        row.created_at = createdAt;
        changes += 1;
      }
    }

    return { changes };
  };

  const runAsync = jest.fn(async (sql: string, ...params: readonly unknown[]) => {
    const statement = sql.trim();
    const alter = ALTER_COLUMN_PATTERN.exec(statement);

    if (alter) {
      return applyAlter(alter[1], alter[2]);
    }

    if (statement.startsWith("CREATE TABLE") && statement.includes("__drizzle_migrations")) {
      ledger ??= [];
      return { changes: 0 };
    }

    const create = CREATE_TABLE_PATTERN.exec(statement);

    if (create) {
      return applyCreate(create[1], create[2]);
    }

    if (statement.startsWith("INSERT INTO __drizzle_migrations")) {
      ledger ??= [];
      ledger.push({ rowid: ledger.length + 1, created_at: Number(params[params.length - 1]) });
      return { changes: 1 };
    }

    if (statement.startsWith("UPDATE __drizzle_migrations")) {
      return applyPin(Number(params[0]));
    }

    return { changes: 0 };
  });

  const getAllAsync = jest.fn(async (sql: string) => {
    const tableInfo = /^PRAGMA table_info\((\w+)\)$/u.exec(sql.trim());

    if (tableInfo) {
      return [...columnsOf(tableInfo[1])].map((name) => ({ name }));
    }

    return [];
  });

  const getFirstAsync = jest.fn(async (sql: string) => {
    if (sql.includes("sqlite_master") && sql.includes("animes")) {
      return columnsByTable.has("animes") ? { name: "animes" } : null;
    }

    if (sql.includes("COUNT(*)") && sql.includes("__drizzle_migrations")) {
      if (!ledger) {
        throw new Error("Error code 1: no such table: __drizzle_migrations");
      }

      return { count: ledger.length };
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

  /** Applies the given journal entries, leaving the schema and ledger a real device would carry. */
  const seedJournalIndexes = async (indexes: readonly number[]) => {
    ledger ??= [];

    for (const index of indexes) {
      for (const statement of readMigrationStatements(JOURNAL_ENTRIES[index].tag)) {
        await runAsync(statement);
      }

      ledger.push({ rowid: ledger.length + 1, created_at: JOURNAL_ENTRIES[index].when });
    }
  };

  /** Applies the previous release's clamp, which is what bricked already-upgraded devices. */
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

  /** Removes the ledger while keeping the application schema, as a very old install would be. */
  const dropLedger = () => {
    ledger = null;
  };

  return {
    appliedTags,
    applyPendingMigrations,
    applyPreviousClamp,
    dropLedger,
    getAllAsync,
    getFirstAsync,
    poisonLedgerRow,
    readLedger: () => (ledger ?? []).map((row) => ({ ...row })),
    runAsync,
    seedJournalIndexes,
  };
}

/** Every journal index, for a device that applied the full set in order. */
const ALL_JOURNAL_INDEXES = JOURNAL_ENTRIES.map((_entry, index) => index);

/** Indexes through the release before `0013`. */
const PREVIOUS_RELEASE_INDEXES = ALL_JOURNAL_INDEXES.slice(0, PREVIOUS_RELEASE_JOURNAL_INDEX + 1);

/**
 * The drizzle migrator bootstraps a FRESH install and nothing else. On a device that already
 * carries the application schema it must apply NOTHING, because ledger contents cannot identify
 * which migrations ran: the migrator writes an empty `hash`, and any device that ever skipped a
 * migration (the H0Xx poisoned gate did exactly that) has a ledger whose row order no longer
 * matches the journal. Re-running one `ALTER TABLE ... ADD COLUMN` aborts the migration and
 * leaves startup permanently failing, so convergence on an installed device belongs entirely to
 * the idempotent repair steps that follow.
 */
describe("migration ledger reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (nativeRuntime.getOpenDatabaseSync as jest.Mock).mockReturnValue(jest.fn());
    (nativeRuntime.getDrizzleFactory as jest.Mock).mockReturnValue(drizzle);
    (nativeRuntime.getDrizzleMigrator as jest.Mock).mockReturnValue(migrate);
  });

  it("applies every migration on a fresh install with no application schema yet", async () => {
    const fake = createFakeDatabase();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual(JOURNAL_ENTRIES.map((entry) => entry.tag));
  });

  it("applies nothing on a device upgrading from the previous release", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
  });

  it("recovers a device the previous clamp already bricked", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    fake.applyPreviousClamp();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
  });

  it("recovers a device whose ledger order no longer matches the journal", async () => {
    const fake = createFakeDatabase();
    // The H0Xx survivor: 0000-0006 applied, 0007-0010 skipped by the poisoned gate, then 0011 and
    // 0012 appended once the old clamp unblocked them. Ledger position 7 holds 0011, not 0007.
    await fake.seedJournalIndexes([0, 1, 2, 3, 4, 5, 6, 11, 12]);
    fake.applyPreviousClamp();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
  });

  it("applies nothing on a device still carrying the poisoned 0006 gate", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes([0, 1, 2, 3, 4, 5, 6]);
    fake.poisonLedgerRow(POISONED_JOURNAL_INDEX, POISONED_CREATED_AT_MS);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
    // The poisoned row must be pinned DOWN too. Leaving it above the journal is what silently
    // skipped 0007-0010 in the first place, and it would skip the next migration the same way.
    expect(fake.readLedger().map((row) => row.created_at)).not.toContain(POISONED_CREATED_AT_MS);
  });

  it("pins every ledger row to the journal maximum so the gate cannot reopen", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    fake.applyPreviousClamp();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await runMigrations(fake as never);

    for (const row of fake.readLedger()) {
      expect(row.created_at).toBe(MAX_JOURNAL_MIGRATION_TIMESTAMP_MS);
    }
  });

  it("stays green on the launch after an installed device has been reconciled once", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    fake.applyPreviousClamp();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await runMigrations(fake as never);
    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
  });

  it("seeds a gate for an installed device carrying no ledger at all", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    fake.dropLedger();
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);

    await expect(runMigrations(fake as never)).resolves.toBeDefined();

    expect(fake.appliedTags).toEqual([]);
    expect(fake.readLedger()).toEqual([
      { rowid: 1, created_at: MAX_JOURNAL_MIGRATION_TIMESTAMP_MS },
    ]);
  });

  it("guards the pin so an already-pinned row is never rewritten", async () => {
    const fake = createFakeDatabase();
    await fake.seedJournalIndexes(PREVIOUS_RELEASE_INDEXES);
    (migrate as jest.Mock).mockImplementation(fake.applyPendingMigrations);
    await runMigrations(fake as never);

    fake.runAsync.mockClear();
    await runMigrations(fake as never);

    // The skip is SQLite's, not ours: the statement carries its own `<>` guard, so a second launch
    // touches no row. Asserting the statement is absent would be wrong -- it is always issued.
    const [pinSql] = fake.runAsync.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.startsWith("UPDATE __drizzle_migrations"));

    expect(pinSql).toContain("WHERE created_at <> ?");
    expect(fake.readLedger().every((row) => row.created_at === MAX_JOURNAL_MIGRATION_TIMESTAMP_MS)).toBe(
      true,
    );
  });
});
