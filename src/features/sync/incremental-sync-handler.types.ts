export interface UseIncrementalSyncHandlerResult {
  handleSyncRequired: () => Promise<void>;
}
