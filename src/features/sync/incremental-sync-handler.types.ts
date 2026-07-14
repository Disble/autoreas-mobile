/** Defines the data contract for use incremental sync handler result. */
export interface UseIncrementalSyncHandlerResult {
  handleSyncRequired: () => Promise<void>;
}
