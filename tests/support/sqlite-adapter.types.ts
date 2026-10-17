/** Options for `applyMigrationFiles`. */
export interface ApplyMigrationFilesOptions {
  /** The last four-digit migration prefix to apply, inclusive (for example `'0018'`). */
  readonly through?: string;
}
