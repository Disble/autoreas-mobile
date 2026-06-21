export type { ApplyRemoteChangesResult } from './apply-remote-changes.helpers';
export { applyRemoteChanges } from './apply-remote-changes.helpers';
export { buildPartialUpdate, isStale } from './field-merge.helpers';
export { decideMerge } from './merge-decision.helpers';
export { loadGuardMap, loadPendingOutboxRecordIds } from './merge-context.helpers';
export type {
  FieldMergeResult,
  MergeContext,
  MergeDecision,
  RemoteAnimeChange,
} from './merge.types';
