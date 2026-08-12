# Write Failure Diagnostics Specification

## Purpose

Local write failures currently render byte-identical text regardless of root cause, making distinct SQLite errors indistinguishable in the field. This capability captures observable write-failure diagnostics — a primary `errcode`, the elapsed time to failure, and the transaction stage at which the failure occurred — in local write failure telemetry so failures can be triaged by cause instead of by guesswork, without changing what the user is shown.

## Requirements

### Requirement: Write Failure Diagnostics Captured

When a local database write fails, the system MUST capture, alongside the human-readable error message: the SQLite primary `errcode` (or a null value when it cannot be determined), the elapsed time from write-attempt start to failure (`elapsedMs`), and the transaction stage at which the failure occurred (`stage`: begin, task, commit, or rollback).

#### Scenario: Poisoned-connection errcode is distinguishable from lock-held errcode

- GIVEN a write fails with the errcode signature of a connection that already had a transaction open
- AND a separate write fails with the errcode signature of another connection holding the write lock
- WHEN both failures are captured in telemetry
- THEN the two telemetry records carry different `errcode` values

#### Scenario: Elapsed time distinguishes an instant rejection from an exhausted wait

- GIVEN a write fails almost immediately because the write-lock upgrade was rejected before the busy handler ever ran
- AND a separate write fails only after waiting close to the configured `busy_timeout` because the busy handler ran and still lost
- WHEN both failures are captured in telemetry
- THEN their `elapsedMs` values are distinguishable between the two failures, even when both report the same `errcode`

#### Scenario: Stage identifies which phase of the transaction failed

- GIVEN a write transaction fails while acquiring the write lock
- WHEN the failure is captured in telemetry
- THEN the recorded `stage` is `begin`, distinguishing it from a failure during the transaction body, commit, or rollback

#### Scenario: Errcode is omitted gracefully when unavailable

- GIVEN a write fails with a message the platform does not expose a recognizable errcode for
- WHEN the failure is captured
- THEN telemetry records a null `errcode` rather than fabricating a value
- AND `elapsedMs` and `stage` are still captured independently of whether `errcode` was determined

### Requirement: User-Facing Failure Copy Remains Unchanged

The system MUST NOT alter the text presented to the user when write-failure diagnostics are captured; the message the user sees MUST remain byte-identical to its current rendering. The captured `errcode`, `elapsedMs`, and `stage` MUST be observable through diagnostic telemetry, independent of the user-facing message.

#### Scenario: User-facing message is unchanged while diagnostics are captured

- GIVEN a chapter mutation write fails and its errcode, elapsedMs, and stage are captured
- WHEN the failure is presented to the user
- THEN the presented message text is identical to the message rendered before diagnostics capture existed
- AND the captured diagnostic fields remain accessible through telemetry, not through the message text
