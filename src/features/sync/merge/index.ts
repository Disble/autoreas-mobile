export type { ApplyRemoteChangesResult } from './merge.types';
export { applyRemoteChanges } from './apply-remote-changes.helpers';
export {
  buildPartialUpdate,
  deriveChangedFields,
  isStale,
} from './field-merge.helpers';
export { decideMerge } from './merge-decision.helpers';
export { loadGuardMap, loadPendingOutboxRecordIds } from './merge-context.helpers';
export type {
  FieldMergeResult,
  MergeContext,
  MergeDecision,
  RemoteAnimeChange,
} from './merge.types';
