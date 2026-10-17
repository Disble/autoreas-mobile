/** One `sqlite_master` entry of a database dump. */
export interface SchemaEntry {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
}

/** A whole database: its schema (without `sqlite_sequence`) and every table's rows in rowid order. */
export interface DatabaseDump {
  readonly schema: readonly SchemaEntry[];
  readonly tables: Readonly<Record<string, readonly unknown[]>>;
}

/** The drizzle surface the real sqlite-proxy migrator runs its statements through. */
export interface MigratorDatabase {
  readonly run: (query: unknown) => Promise<unknown>;
}
