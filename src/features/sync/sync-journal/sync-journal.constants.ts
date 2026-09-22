import type { SyncCycleStage } from '../sync-runtime-status.types';
import type { JournalAttemptState } from './sync-journal.types';

/** Provides the registered name of the native sync-journal module. */
export const SYNC_JOURNAL_NATIVE_MODULE_NAME = 'SyncJournal';

/**
 * The state a cycle's journal tracking starts in. Per the attempt state machine
 * (docs/mobile-sync-architecture.md 6.2), `idle` is where a cycle sits once a trigger was
 * accepted and nothing was done yet.
 */
export const JOURNAL_INITIAL_STATE: JournalAttemptState = 'idle';

/**
 * Maps each checkpoint stage the sync cycle publishes onto the journal's FSM state it
 * demonstrates. `open`/`config` are the first stages of a new cycle, so they enter `checked`
 * from {@link JOURNAL_INITIAL_STATE}; the read-only attempt stages stay in `checked`; the
 * effect stages move the machine through `claimed` -> `sent` -> `applied` -> `pruned` ->
 * `closed`. The lookup is consulted defensively at record time, so a runtime stage that is
 * not a key here is ignored instead of guessed.
 */
export const STAGE_TO_JOURNAL_STATE: Readonly<Record<SyncCycleStage, JournalAttemptState>> = {
  open: 'checked',
  config: 'checked',
  attempt_started: 'checked',
  cycle_activated: 'checked',
  backlog_read: 'checked',
  claim_ops: 'claimed',
  http: 'sent',
  parse_response: 'sent',
  apply_write: 'applied',
  prune: 'pruned',
  closed: 'closed',
};
