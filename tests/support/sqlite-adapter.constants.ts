import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * The exact `SQLiteDatabase` members the app touches, enumerated from real call sites across
 * `src/` (design D2). Any other `SQLiteDatabase`-shaped access throws instead of returning
 * `undefined`, so a missing implementation fails loudly rather than producing a suite that is
 * green against a fiction.
 */
export const IMPLEMENTED_MEMBERS = new Set([
  'databasePath',
  'execAsync',
  'execSync',
  'runAsync',
  'getAllAsync',
  'getFirstAsync',
]);

/**
 * Properties the JavaScript runtime and jest probe on arbitrary objects. These are not
 * `SQLiteDatabase` members and never will be, so they must fall through rather than throw.
 * `then` is the critical one: any `await adapter` or `Promise.resolve(adapter)` reads it to
 * decide whether the value is a thenable, and a throw there surfaces far from its cause.
 */
export const PROBE_MEMBERS = new Set([
  'then',
  'catch',
  'finally',
  'constructor',
  'toJSON',
  'toString',
  'inspect',
  'valueOf',
  'asymmetricMatch',
  '$$typeof',
  'nodeType',
]);

/** Directory holding the production SQL migration files the app ships. */
export const MIGRATIONS_DIR = join(
  __dirname,
  '..',
  '..',
  'src',
  'infrastructure',
  'db',
  'migrations',
);

/** Maps each adapter back to its underlying `node:sqlite` handle for the drizzle proxy. */
export const NATIVE_BY_ADAPTER = new WeakMap<object, DatabaseSync>();
