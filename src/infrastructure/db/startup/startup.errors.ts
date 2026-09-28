/** Signals that foreground startup has not established the expected durable schema version. */
export class SchemaNotReadyError extends Error {
  readonly reason: 'missing' | 'stale';

  constructor(reason: 'missing' | 'stale') {
    super(`Local schema readiness is ${reason}.`);
    this.name = 'SchemaNotReadyError';
    this.reason = reason;
  }
}

/** Signals that the database was prepared by a schema version this app cannot safely consume. */
export class SchemaIncompatibleError extends Error {
  readonly actualVersion: number;

  constructor(actualVersion: number) {
    super('Local schema readiness version is incompatible.');
    this.name = 'SchemaIncompatibleError';
    this.actualVersion = actualVersion;
  }
}

/** Signals that a required table or column is absent from the prepared local schema. */
export class SchemaValidationError extends Error {
  constructor() {
    super('Local schema validation failed.');
    this.name = 'SchemaValidationError';
  }
}

/**
 * Signals that SQLite's own integrity check rejected the database file itself.
 *
 * This is deliberately NOT a `SchemaValidationError`: a missing table or column is a logical
 * mismatch the repair path can fix by re-running the migrator, but physical damage cannot be
 * repaired by migrating. Sharing one error type made the two indistinguishable, so a damaged file
 * was re-migrated and re-stamped on every launch, and startup died in a loop instead of reporting
 * the one condition that authorizes a user-confirmed reset.
 */
export class SchemaIntegrityError extends Error {
  constructor() {
    super('Local database integrity check failed.');
    this.name = 'SchemaIntegrityError';
  }
}
