import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from '../client/client.helpers';
import {
  EXPECTED_SCHEMA_READINESS_VERSION,
  REQUIRED_SCHEMA_TABLE_COUNT_SQL,
  REQUIRED_SCHEMA_TABLES,
  SQLITE_BUSY_TIMEOUT_MS,
} from './startup.constants';
import {
  SchemaIncompatibleError,
  SchemaNotReadyError,
  SchemaValidationError,
} from './startup.errors';
import type {
  SchemaIntegrityRow,
  SchemaReadinessRow,
  SchemaTableCountRow,
} from './startup.types';

async function validatePreparedSchema(rawDb: SQLiteDatabase): Promise<void> {
  const [integrity, tableCount] = await Promise.all([
    rawDb.getFirstAsync<SchemaIntegrityRow>('PRAGMA quick_check;'),
    rawDb.getFirstAsync<SchemaTableCountRow>(
      REQUIRED_SCHEMA_TABLE_COUNT_SQL,
      ...REQUIRED_SCHEMA_TABLES,
    ),
  ]);

  if (
    integrity?.quick_check !== 'ok' ||
    Number(tableCount?.count) !== REQUIRED_SCHEMA_TABLES.length
  ) {
    throw new SchemaValidationError();
  }
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
    await validatePreparedSchema(rawDb);
    return;
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

/**
 * Applies connection-local safety policy and verifies foreground-owned schema readiness.
 * Headless actors call this read-only boundary before touching application tables.
 */
export async function prepareHeadlessDatabase(rawDb: SQLiteDatabase): Promise<void> {
  await rawDb.execAsync(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
  const readiness = await rawDb.getFirstAsync<SchemaReadinessRow>('PRAGMA user_version;');
  const actualVersion = readiness?.user_version;

  if (actualVersion === EXPECTED_SCHEMA_READINESS_VERSION) {
    return;
  }

  if (actualVersion === 0) {
    throw new SchemaNotReadyError('missing');
  }

  if (
    typeof actualVersion === 'number' &&
    actualVersion > 0 &&
    actualVersion < EXPECTED_SCHEMA_READINESS_VERSION
  ) {
    throw new SchemaNotReadyError('stale');
  }

  throw new SchemaIncompatibleError(actualVersion ?? -1);
}
