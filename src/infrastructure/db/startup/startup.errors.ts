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

/** Signals that integrity or required-table validation rejected the prepared local schema. */
export class SchemaValidationError extends Error {
	constructor() {
    super('Local schema validation failed.');
    this.name = 'SchemaValidationError';
  }
}
