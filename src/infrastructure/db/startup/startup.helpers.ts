import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../client/client.helpers';
import {
  EXPECTED_SCHEMA_READINESS_VERSION,
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_TABLE_COUNT_SQL,
  REQUIRED_SCHEMA_TABLES,
  SQLITE_BUSY_TIMEOUT_MS,
} from './startup.constants';
import {
  SchemaIncompatibleError,
  SchemaIntegrityError,
  SchemaValidationError,
} from './startup.errors';
import type {
  SchemaColumnInfoRow,
  SchemaIntegrityRow,
  SchemaReadinessRow,
  SchemaTableCountRow,
} from './startup.types';

/**
 * Proves every REQUIRED_SCHEMA_COLUMNS table carries every column it must have, not just that the
 * table itself exists. A table surviving in `sqlite_master` proves nothing about which columns a
 * silently skipped migration would have added -- this is the guard that makes that bug class
 * (H0Xx: a poisoned journal `when` gate) impossible to repeat, because a skipped migration can no
 * longer stamp readiness over it.
 */
async function validateRequiredColumns(rawDb: SQLiteDatabase): Promise<void> {
  const tableEntries = Object.entries(REQUIRED_SCHEMA_COLUMNS);

  const columnsByTable = await Promise.all(
    tableEntries.map(([tableName]) =>
      rawDb.getAllAsync<SchemaColumnInfoRow>(`PRAGMA table_info(${tableName})`),
    ),
  );

  const hasMissingColumn = tableEntries.some(([, requiredColumns], index) => {
    const existingColumnNames = new Set(columnsByTable[index].map((column) => column.name));
    return requiredColumns.some((columnName) => !existingColumnNames.has(columnName));
  });

  if (hasMissingColumn) {
    throw new SchemaValidationError();
  }
}

/**
 * Proves the database is usable before readiness is stamped: the file passes SQLite's own
 * integrity check, every required table exists, AND every required column on those tables exists.
 * All three run before the version is written, so a half-prepared database never gets marked
 * ready and then trusted by the headless path.
 *
 * The two failure kinds stay separate on purpose. A failed `quick_check` is physical damage and
 * throws `SchemaIntegrityError`, which no amount of migrating can heal. A short table count or a
 * missing column is a logical mismatch the repair path may legitimately fix, and throws
 * `SchemaValidationError`. Both are detected by the same probes that already ran here, so the
 * healthy path gains no extra query.
 */
async function validatePreparedSchema(rawDb: SQLiteDatabase): Promise<void> {
  const [integrity, tableCount] = await Promise.all([
    rawDb.getFirstAsync<SchemaIntegrityRow>('PRAGMA quick_check;'),
    rawDb.getFirstAsync<SchemaTableCountRow>(
      REQUIRED_SCHEMA_TABLE_COUNT_SQL,
      ...REQUIRED_SCHEMA_TABLES,
    ),
  ]);

  if (integrity?.quick_check !== 'ok') {
    throw new SchemaIntegrityError();
  }

  if (Number(tableCount?.count) !== REQUIRED_SCHEMA_TABLES.length) {
    throw new SchemaValidationError();
  }

  await validateRequiredColumns(rawDb);
}

/**
 * Configures the foreground connection, prepares the schema, validates it, and establishes readiness.
 * The marker is the final write so every actor can treat its presence as proof that all prior stages succeeded.
 */
export async function prepareForegroundDatabase(rawDb: SQLiteDatabase): Promise<void> {
  await rawDb.execAsync(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
  await rawDb.execAsync('PRAGMA journal_mode = WAL;');
  const readiness = await rawDb.getFirstAsync<SchemaReadinessRow>('PRAGMA user_version;');
  const actualVersion = readiness?.user_version;

  if (actualVersion === EXPECTED_SCHEMA_READINESS_VERSION) {
    try {
      await validatePreparedSchema(rawDb);
      return;
    } catch (error) {
      if (!(error instanceof SchemaValidationError)) {
        // Physical damage is NOT repairable here and must never reach `runMigrations`. Re-running
        // the migrator against a malformed image, re-validating, and re-stamping it is exactly how
        // a damaged file turned every launch into a fresh repair attempt that ended in a fatal
        // card. Propagating immediately keeps the integrity failure intact for the startup
        // diagnostic to classify as `corruption` and stops the write path here.
        throw error;
      }

      // A stamped readiness version is NOT proof the schema is whole -- that is the exact
      // assumption this guard disproves. A silently skipped migration leaves the schema short a
      // column while readiness gets stamped over it anyway, so a failed validation HERE is the
      // signature of that bug, not a reason to refuse to start. Falling through re-runs the
      // migrator and the idempotent repair steps, re-validates, and re-stamps.
      //
      // Refusing instead would turn a silent no-op sync into a hard startup crash on precisely
      // the device this path exists to rescue. The validation after the repair is deliberately
      // NOT caught: the repair gets exactly one chance, and genuine corruption still fails.
    }
  }

  if (
    typeof actualVersion !== 'number' ||
    actualVersion < 0 ||
    actualVersion > EXPECTED_SCHEMA_READINESS_VERSION
  ) {
    throw new SchemaIncompatibleError(actualVersion ?? -1);
  }

  await runMigrations(rawDb);
  await validatePreparedSchema(rawDb);

  await rawDb.execAsync(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
}
