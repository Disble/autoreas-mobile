/** One `animes` row shaped for direct insertion, with every NOT NULL column populated. */
export interface AnimeRowFixture {
  _id: string;
  nombre: string;
  estado: number;
  nrocapvisto: number;
  activo: number;
  primeravez: number;
  [column: string]: unknown;
}

/** One `operation_log` row as the app persists it, with `payload` already JSON-encoded. */
export interface OperationLogRowFixture {
  anime_id: string;
  operation: string;
  payload: string;
  status: string;
  created_at: number;
  [column: string]: unknown;
}

/** One entry of the bridge's `applied_operations` array. */
export interface AppliedOperationFixture {
  anime_id: string;
  operation: string;
  applied: boolean;
}

/** Options accepted when composing a reconcile response body. */
export interface ReconcileResponseBodyOptions {
  readonly appliedOperations?: readonly AppliedOperationFixture[];
  readonly bridgeChanges?: readonly unknown[];
  readonly lastChangelogId?: number;
  readonly status?: string;
}
