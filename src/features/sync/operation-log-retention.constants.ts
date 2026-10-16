import type { OperationLogRetentionPolicy } from './operation-log-retention.types';

/**
 * Defines the default retention policy that bounds synced history growth. Given-up rows
 * (`dead_letter`, `conflict_exhausted`) have no retention: they are unresolved keys and stay
 * until resolved (ADR 009 R-16b).
 */
export const DEFAULT_OPERATION_LOG_RETENTION_POLICY: OperationLogRetentionPolicy = {
  synced: {
    ttlDays: 7,
    maxCount: 1000,
  },
  now: () => Date.now(),
};

/**
 * Defines the milliseconds contained in one retention-policy day.
 */
export const OPERATION_LOG_RETENTION_DAY_IN_MS = 24 * 60 * 60 * 1000;
