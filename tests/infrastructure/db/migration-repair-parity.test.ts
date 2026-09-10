import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ANIMES_COLUMN_DEFINITIONS,
  BRIDGE_CONFIG_COLUMN_DEFINITIONS,
  OPERATION_LOG_COLUMN_DEFINITIONS,
  SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
} from "../../../src/infrastructure/db/client/client.constants";
import { REQUIRED_SCHEMA_TABLES } from "../../../src/infrastructure/db/startup/startup.constants";

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

/** Every repair definition, keyed by the table it repairs. */
const REPAIR_DEFINITIONS_BY_TABLE: Readonly<Record<string, readonly { columnName: string }[]>> = {
  animes: ANIMES_COLUMN_DEFINITIONS,
  bridge_config: BRIDGE_CONFIG_COLUMN_DEFINITIONS,
  operation_log: OPERATION_LOG_COLUMN_DEFINITIONS,
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

/** Every `ALTER TABLE ... ADD COLUMN` any migration after the baseline declares. */
function readDeclaredColumns(): readonly { file: string; table: string; column: string }[] {
  return listMigrationFiles().flatMap((file) =>
    [...readMigrationSql(file).matchAll(/ALTER TABLE `?(\w+)`? ADD (?:COLUMN )?`?(\w+)`?/gu)].map(
      (match) => ({ file, table: match[1], column: match[2] }),
    ),
  );
}

/** Every `CREATE TABLE` any migration after the baseline declares. */
function readDeclaredTables(): readonly { file: string; table: string }[] {
  return listMigrationFiles().flatMap((file) =>
    [...readMigrationSql(file).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?/gu)].map(
      (match) => ({ file, table: match[1] }),
    ),
  );
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

  it("keeps every table a migration creates in the required-schema set", () => {
    const declared = readDeclaredTables();
    const missing = declared.filter(({ table }) => !REQUIRED_SCHEMA_TABLES.includes(table as never));

    expect(declared.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
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
