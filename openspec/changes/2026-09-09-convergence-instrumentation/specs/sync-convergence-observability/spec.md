# Sync Convergence Observability Specification

## Purpose

Sync cannot today distinguish a converged device from a permanently stuck one: terminal-failure rows (`dead_letter`, `conflict_exhausted`) are counted nowhere before retention deletes them, and `pending_ops_count` is a bounded-batch count (capped by `RECONCILE_BACKLOG_BATCH_LIMIT`), not true queue depth. This capability adds a convergence projection over `operation_log` — terminal-failure counts, stuck-`processing` rows, oldest-pending age, and true backlog depth with an explicit continuation flag — reusing the existing per-status count primitive, and exposes it through the same consumer surface as existing sync counters, without a new screen.

## Requirements

### Requirement: Terminal-Failure Operation Counts Are Observable Before Retention Deletes Them

The system MUST report the current count of `operation_log` rows in each terminal-failure status (`dead_letter`, `conflict_exhausted`) as part of a convergence projection, computed before retention pruning removes those rows.

#### Scenario: A device with dead-letter rows reports a non-zero count

- GIVEN `operation_log` holds rows in `dead_letter` status
- WHEN the convergence projection is computed
- THEN it reports a `dead_letter` count matching those rows

#### Scenario: A device with conflict-exhausted rows reports a non-zero count

- GIVEN `operation_log` holds rows in `conflict_exhausted` status
- WHEN the convergence projection is computed
- THEN it reports a `conflict_exhausted` count matching those rows

### Requirement: Stuck Processing Rows And The Oldest Pending Operation's Age Are Observable

The convergence projection MUST report the count of `operation_log` rows currently in `processing` status and the age, relative to now, of the oldest row in `pending` or `processing` status.

#### Scenario: Rows stuck in processing are counted

- GIVEN `operation_log` holds rows in `processing` status
- WHEN the convergence projection is computed
- THEN it reports a `processing` count matching those rows

#### Scenario: The oldest pending operation's age reflects its creation time

- GIVEN the oldest `pending`-or-`processing` row was created at a known timestamp
- WHEN the convergence projection is computed at a later time
- THEN it reports that row's age as the difference between now and its creation time

### Requirement: True Backlog Depth Is Distinct From The Bounded Batch Count, With An Explicit Continuation Flag

The convergence projection MUST report the true count of `pending`-or-`processing` rows independent of any per-cycle batch limit, and MUST report an explicit `has_more` flag indicating whether that true count exceeds what one cycle's bounded batch will process, so the telemetry envelope's `pending_ops_count` is never read as queue depth.

#### Scenario: A backlog larger than the batch limit reports has_more as true

- GIVEN the true backlog row count exceeds the reconcile batch limit
- WHEN the convergence projection is computed
- THEN `has_more` is true

#### Scenario: A backlog at or under the batch limit reports has_more as false

- GIVEN the true backlog row count is at or below the reconcile batch limit
- WHEN the convergence projection is computed
- THEN `has_more` is false

### Requirement: The Convergence Projection Is Available Through The Existing Sync Counters Surface

The convergence projection MUST be exposed through the same consumer surface used by existing sync runtime counters, without introducing a new screen.

#### Scenario: The projection's counts render alongside existing background-sync counters

- GIVEN the convergence projection has been computed for the current device state
- WHEN the existing background-sync status surface is read
- THEN it includes the projection's terminal-failure counts, stuck-processing count, oldest-pending age, and `has_more` flag
