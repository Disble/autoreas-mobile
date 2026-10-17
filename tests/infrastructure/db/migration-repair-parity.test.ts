import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ANIMES_COLUMN_DEFINITIONS,
  APP_PREFERENCES_COLUMN_DEFINITIONS,
  BRIDGE_CONFIG_COLUMN_DEFINITIONS,
  OPERATION_LOG_COLUMN_DEFINITIONS,
  SYNC_CYCLE_LOCK_COLUMN_DEFINITIONS,
  SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
} from "../../../src/infrastructure/db/client/client.constants";
import { DEAD_SYNC_RUNTIME_STATUS_COLUMNS } from "../../../src/infrastructure/db/client/sync-runtime-status-column-drop.constants";
import {
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_TABLES,
} from "../../../src/infrastructure/db/startup/startup.constants";

/** Directory holding the migration SQL this contract is measured against. */
const MIGRATIONS_DIRECTORY = join(__dirname, "../../../src/infrastructure/db/migrations");

/** Migration `0000` creates the baseline schema; only later migrations need repair twins. */
const BASELINE_MIGRATION_PREFIX = "0000_";

/**
 * `bridge_config.last_changelog_id` is repaired by `ensureBridgeConfigLastChangelogId`, a bespoke
 * step rather than a `MissingColumnDefinition`, because it also sanitises the stored cursor value.
 * Naming it here keeps the exemption explicit instead of a silent hole in the contract.
 */
const BESPOKE_REPAIR_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  bridge_config: ["last_changelog_id"],
};

/**
 * Every column a repair step drops, keyed by table: an installed device's route to a migration's
 * `DROP COLUMN`. It may name more columns than the migration does -- a column only a repair step
 * ever created, or one in a packed chunk's discarded tail, is not on a fresh install to drop.
 */
const REPAIR_DROPPED_COLUMNS_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  sync_runtime_status: DEAD_SYNC_RUNTIME_STATUS_COLUMNS,
};

/** Every repair definition, keyed by the table it repairs. */
const REPAIR_DEFINITIONS_BY_TABLE: Readonly<Record<string, readonly { columnName: string }[]>> = {
  animes: ANIMES_COLUMN_DEFINITIONS,
  app_preferences: APP_PREFERENCES_COLUMN_DEFINITIONS,
  bridge_config: BRIDGE_CONFIG_COLUMN_DEFINITIONS,
  operation_log: OPERATION_LOG_COLUMN_DEFINITIONS,
  sync_cycle_lock: SYNC_CYCLE_LOCK_COLUMN_DEFINITIONS,
  sync_runtime_status: SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
};

/** Migration files after the baseline, in journal order. */
function listMigrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith(".sql") && !name.startsWith(BASELINE_MIGRATION_PREFIX))
    .sort();
}

/** Reads one migration with its `--` comment lines stripped, so prose is never read as SQL. */
function readMigrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/**
 * Every table a migration drops. A dropped table is retired on BOTH routes: a fresh install runs
 * the `DROP`, and an installed device runs the repair step that retires it (for
 * `season_rating_queue`, `moveSeasonRatingQueueIntoOperationLog`). Its earlier `CREATE` and
 * `ADD COLUMN`s therefore need no repair twin and no readiness proof: the net schema lacks it.
 */
function readDroppedTables(): ReadonlySet<string> {
  return new Set(
    listMigrationFiles().flatMap((file) =>
      [...readMigrationSql(file).matchAll(/DROP TABLE (?:IF EXISTS )?`?(\w+)`?/gu)].map((match) => match[1]),
    ),
  );
}

/**
 * Every `table.column` a migration drops with `ALTER TABLE ... DROP COLUMN`. Like a dropped table, a
 * dropped column is retired on BOTH routes -- a fresh install runs the `DROP COLUMN`, an installed
 * device runs the repair step that drops it (for `sync_runtime_status`,
 * `dropDeadSyncRuntimeStatusColumns`) -- so its earlier `ADD COLUMN` needs no repair twin. A twin
 * would in fact re-add it on every startup.
 */
function readDroppedColumns(): ReadonlySet<string> {
  return new Set(
    listMigrationFiles().flatMap((file) =>
      [...readMigrationSql(file).matchAll(/ALTER TABLE `?(\w+)`? DROP (?:COLUMN )?`?(\w+)`?/gu)].map(
        (match) => `${match[1]}.${match[2]}`,
      ),
    ),
  );
}

/** Every `ALTER TABLE ... ADD COLUMN` any migration after the baseline declares on a table and column it keeps. */
function readDeclaredColumns(): readonly { file: string; table: string; column: string }[] {
  const dropped = readDroppedTables();
  const droppedColumns = new Set([
    ...readDroppedColumns(),
    ...Object.entries(REPAIR_DROPPED_COLUMNS_BY_TABLE).flatMap(([table, columns]) =>
      columns.map((column) => `${table}.${column}`),
    ),
  ]);

  return listMigrationFiles().flatMap((file) =>
    [...readMigrationSql(file).matchAll(/ALTER TABLE `?(\w+)`? ADD (?:COLUMN )?`?(\w+)`?/gu)].map(
      (match) => ({ file, table: match[1], column: match[2] }),
    ),
  ).filter(({ table, column }) => !dropped.has(table) && !droppedColumns.has(`${table}.${column}`));
}

/** Every `CREATE TABLE` any migration after the baseline declares for a table it keeps. */
function readDeclaredTables(): readonly { file: string; table: string }[] {
  const dropped = readDroppedTables();

  return listMigrationFiles().flatMap((file) =>
    [...readMigrationSql(file).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?/gu)].map(
      (match) => ({ file, table: match[1] }),
    ),
  ).filter(({ table }) => !dropped.has(table));
}

/**
 * On an installed device the drizzle migrator applies NOTHING — `reconcileMigrationLedger` pins
 * its gate, because ledger contents cannot identify which migrations that device actually ran.
 * That makes the idempotent repair steps the only route a schema change has to a device already
 * in the field, and this contract is what keeps that route complete.
 *
 * A migration column with no repair twin reaches nobody but a fresh install, and the failure is
 * silent: the app runs new code against an old table and dies on the first write to a column that
 * was never created.
 */
describe("migration / repair parity", () => {
  it("gives every migration column an idempotent repair twin", () => {
    const declared = readDeclaredColumns();
    const missing = declared.filter(({ table, column }) => {
      if ((BESPOKE_REPAIR_COLUMNS[table] ?? []).includes(column)) {
        return false;
      }

      const definitions = REPAIR_DEFINITIONS_BY_TABLE[table] ?? [];
      return !definitions.some((definition) => definition.columnName === column);
    });

    expect(declared.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("gives every required-schema column an idempotent repair twin", () => {
    // REQUIRED_SCHEMA_COLUMNS is the readiness proof: `validatePreparedSchema` refuses to stamp
    // a version over a database missing one of these columns. A proof with no repair twin would
    // turn every legacy device into a permanent startup failure instead of repairing it, so the
    // two maps are held to the same coverage here.
    const missing = Object.entries(REQUIRED_SCHEMA_COLUMNS).flatMap(([table, columns]) =>
      columns
        .filter((column) => {
          if ((BESPOKE_REPAIR_COLUMNS[table] ?? []).includes(column)) {
            return false;
          }

          const definitions = REPAIR_DEFINITIONS_BY_TABLE[table] ?? [];
          return !definitions.some((definition) => definition.columnName === column);
        })
        .map((column) => ({ table, column })),
    );

    expect(missing).toEqual([]);
  });

  it("keeps every table a migration creates in the required-schema set", () => {
    const declared = readDeclaredTables();
    const missing = declared.filter(({ table }) => !REQUIRED_SCHEMA_TABLES.includes(table as never));

    expect(declared.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("keeps every table a migration drops out of the required-schema set", () => {
    // Readiness must never demand a table the net schema retired: a fresh install's DROP and an
    // installed device's retiring repair step would both leave it failing validation forever.
    const dropped = [...readDroppedTables()];

    expect(dropped).toEqual(["season_rating_queue"]);
    expect(dropped.filter((table) => REQUIRED_SCHEMA_TABLES.includes(table as never))).toEqual([]);
    expect(dropped.filter((table) => table in REQUIRED_SCHEMA_COLUMNS)).toEqual([]);
  });

  it("gives no dropped column a repair twin or a readiness proof", () => {
    // A repair twin for a dropped column would re-add it on every startup, undoing the drop on
    // every installed device; a readiness proof for one would refuse every database forever.
    const dropped = [...readDroppedColumns()];
    const twinned = dropped.filter((entry) => {
      const [table, column] = entry.split(".");

      return (REPAIR_DEFINITIONS_BY_TABLE[table] ?? []).some((definition) => definition.columnName === column);
    });
    const proven = dropped.filter((entry) => {
      const [table, column] = entry.split(".");

      return (REQUIRED_SCHEMA_COLUMNS[table] ?? []).includes(column);
    });

    expect(dropped.length).toBeGreaterThan(0);
    expect(twinned).toEqual([]);
    expect(proven).toEqual([]);
  });

  it("gives every migration-dropped column a repair step that drops it", () => {
    // The drop's own parity: a column only the migration drops stays on every installed device.
    const missing = [...readDroppedColumns()].filter((entry) => {
      const [table, column] = entry.split(".");

      return !(REPAIR_DROPPED_COLUMNS_BY_TABLE[table] ?? []).includes(column);
    });

    expect(missing).toEqual([]);
  });

  it("gives no repair-dropped column a repair twin or a readiness proof", () => {
    const retired = Object.entries(REPAIR_DROPPED_COLUMNS_BY_TABLE).flatMap(([table, columns]) =>
      columns.filter(
        (column) =>
          (REPAIR_DEFINITIONS_BY_TABLE[table] ?? []).some((definition) => definition.columnName === column) ||
          (REQUIRED_SCHEMA_COLUMNS[table] ?? []).includes(column),
      ),
    );

    expect(retired).toEqual([]);
  });

  it("still covers a migration that packed several statements into one chunk", () => {
    // drizzle hands each `--> statement-breakpoint` chunk to expo's `prepareSync`, which compiles
    // ONE statement and discards the tail, so a packed migration never applied its later columns on
    // any device. Those columns exist only because a repair twin created them — which the first
    // assertion above proves. This one proves such chunks really exist, so that is not vacuous.
    const packed = listMigrationFiles().filter((file) =>
      readMigrationSql(file)
        .split("--> statement-breakpoint")
        .some((chunk) => chunk.split(";").filter((part) => part.trim().length > 0).length > 1),
    );

    expect(packed.length).toBeGreaterThan(0);
  });
});
