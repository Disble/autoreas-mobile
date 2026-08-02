/** SQLite row returned by the durable schema readiness pragma. */
export interface SchemaReadinessRow {
  readonly user_version: number;
}

/** SQLite row returned by the bounded integrity check. */
export interface SchemaIntegrityRow {
  readonly quick_check: string;
}

/** SQLite row returned by required-table validation. */
export interface SchemaTableCountRow {
  readonly count: number;
}
