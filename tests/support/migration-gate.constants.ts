import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Every query batch the real drizzle gate handed its callback, one entry per `migrate()` call.
 * An installed device's batch is `[]`: the gate applied nothing. Tests clear it before each run.
 */
export const GATE_MIGRATOR_LOG: string[][] = [];

/** Maps each crashing proxy to the test adapter behind it, so drizzle can find the native handle. */
export const CRASHING_PROXY_TARGETS = new WeakMap<object, SQLiteDatabase>();

/**
 * The last migration v1.12.0 shipped (`0017_add_animes_folder_relative`): a device on that release
 * holds migrations 0000-0017, readiness 18 and a ledger pinned to 0017's `when`.
 */
export const V1_12_0_LAST_MIGRATION = '0017';

/** The readiness stamp v1.12.0 wrote: its journal held 18 migrations. */
export const V1_12_0_READINESS_VERSION = 18;
