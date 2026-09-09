# Sync Cycle Telemetry Completeness Specification

## Purpose

The per-cycle diagnostic envelope (`client_telemetry`) already has a bridge-side slot for the previous cycle's identity, stage, error, and elapsed time, but the mobile write path never fills seven of those fields, so every `previous_cycle.*` report is null and `elapsed_ms` is unreachable. This capability makes the attempt lifecycle write its own identity and stage on every transition, and restricts those written values to the bridge's closed vocabularies at compile time.

## Non-Goals

Adding `lastBacklogReadCount` / `lastPrunedOperationsCount` to the outgoing telemetry envelope's counters is explicitly out of scope. Both counters are already observable end to end on the device (recorded into the runtime-status snapshot and rendered in the Settings background-sync section); the bridge's `syncdiag.Record` struct has no field to receive them, so `json.Unmarshal` would silently drop them and `request_captures.request_body` is a pruned debug capture, not a durable store. Sending them would manufacture a new dead field inside a change whose purpose is to remove dead fields. When the bridge adds matching columns, wiring the client side is a one-line follow-up at that time.

## Requirements

### Requirement: The Seven Cycle-Identity And Stage Fields Are Persisted On Every Attempt Lifecycle Patch

The start, success, and failure patches for a sync attempt MUST together persist the cycle id, the current stage, the stage timestamp, and — on failure — the error name, error stage, and native error code byte, so a later cycle's `previous_cycle.*` report reflects the prior attempt instead of staying null.

#### Scenario: A started cycle records its identity and stage

- GIVEN a sync cycle starts
- WHEN the start patch is persisted
- THEN the snapshot's cycle id, stage, and stage timestamp reflect that cycle

#### Scenario: A succeeded cycle clears the previous error detail

- GIVEN a sync cycle succeeds
- WHEN the success patch is persisted
- THEN the snapshot's error name, error stage, and native error code byte are cleared to null

#### Scenario: A failed cycle records the stage and error it failed with

- GIVEN a sync cycle fails at a known stage with a classified error
- WHEN the failure patch is persisted
- THEN the snapshot's stage, error name, error stage, and native error code byte reflect that failure

### Requirement: Consecutive Unclosed Cycles Reflects Cycles That Started Without Closing

The system MUST increment `consecutiveUnclosedCycles` each time a new cycle starts while the previous cycle's start was never followed by a success or failure record, and MUST reset it to zero once a cycle closes.

#### Scenario: The counter increments across consecutive unclosed starts

- GIVEN two cycles in a row start without an intervening success or failure record
- WHEN the second cycle's start patch is persisted
- THEN `consecutiveUnclosedCycles` is greater than it was before the first

#### Scenario: A closed cycle resets the counter

- GIVEN `consecutiveUnclosedCycles` is greater than zero
- WHEN a cycle succeeds or fails
- THEN `consecutiveUnclosedCycles` is reset to zero

### Requirement: Elapsed Time Is Reported When A Previous Attempt Timestamp Exists

Building a cycle's telemetry MUST supply the current time so `previous_cycle.elapsed_ms` is non-null whenever a previous attempt timestamp is on record, and MUST remain null only when no prior attempt exists.

#### Scenario: elapsed_ms is present following a prior attempt

- GIVEN the snapshot records a previous attempt's start timestamp
- WHEN telemetry is built for the current cycle
- THEN `previous_cycle.elapsed_ms` is a non-null, non-negative number

#### Scenario: elapsed_ms stays null with no prior attempt

- GIVEN no cycle has ever attempted before
- WHEN telemetry is built for the current cycle
- THEN `previous_cycle` is null and no `elapsed_ms` is reported

### Requirement: Reported Stage And Error Values Are Restricted To Closed Vocabularies At Build Time

The stage, error-name, and error-stage inputs accepted by the attempt lifecycle patches MUST be typed as closed unions mirroring the bridge's fixed vocabularies, so a value outside those sets cannot be constructed by a caller, rather than being normalized away only when serialized.

#### Scenario: An out-of-vocabulary literal is rejected at compile time

- GIVEN a caller attempts to pass a stage, error name, or error stage value outside the closed set
- WHEN the code is type-checked
- THEN the build fails

#### Scenario: A valid vocabulary member reaches the report unchanged

- GIVEN a caller passes a value that is a member of the closed set
- WHEN telemetry is built and reported
- THEN the reported value is that same member
