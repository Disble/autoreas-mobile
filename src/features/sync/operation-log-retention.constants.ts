import type { OperationLogRetentionPolicy } from './operation-log-retention.types';

/**
 * Defines the default retention policy that bounds synced and dead-letter history growth.
 */
export const DEFAULT_OPERATION_LOG_RETENTION_POLICY: OperationLogRetentionPolicy = {
  synced: {
    status: 'synced',
    ttlDays: 7,
    maxCount: 1000,
  },
  deadLetter: {
    status: 'dead_letter',
    ttlDays: 30,
    maxCount: 500,
  },
  // Same cadence as dead_letter: both are "something went permanently wrong" terminal states,
  // and a row here is at least as worth keeping around for diagnosis (design.md Decision 6).
  conflictExhausted: {
    status: 'conflict_exhausted',
    ttlDays: 30,
    maxCount: 500,
  },
  now: () => Date.now(),
};

/**
 * Defines the milliseconds contained in one retention-policy day.
 */
export const OPERATION_LOG_RETENTION_DAY_IN_MS = 24 * 60 * 60 * 1000;
