# Sync Diagnostics Delivery Specification

## Purpose

A sync cycle's diagnostic post-mortem — the `client_telemetry` envelope describing how the previous cycle ended — is built correctly on every telemetry-eligible cycle but today has nowhere durable to land: it only reaches the bridge riding on the same reconcile request its own diagnosis exists to explain, so when that request fails to reach the bridge — the normal case for a local-first app while offline — the freshly built envelope is discarded with it. This capability durably captures that envelope before transmission is attempted, delivers it opportunistically on any later sync cycle regardless of what triggered it, and bounds the resulting diagnostics outbox so a device that never reconnects cannot grow it without limit.

## Requirements

### Requirement: Diagnostic Envelope Is Captured Durably Before Transmission Is Attempted

When a sync cycle builds a `client_telemetry` envelope, the system MUST durably capture that envelope, as a diagnostics outbox entry, before the request that would transmit it is attempted. That durable entry MUST remain present afterward regardless of whether the transmission attempt succeeds, fails, or is never acknowledged.

#### Scenario: Envelope survives a failed reconcile request

- GIVEN a sync cycle has built a `client_telemetry` envelope
- WHEN the reconcile request that carries that envelope throws or returns a non-2xx response
- THEN a durable diagnostics outbox entry for that cycle's `cycle_id` exists after the cycle completes

#### Scenario: Capture happens before the request is attempted, not after

- GIVEN a sync cycle has finished building its `client_telemetry` envelope for this cycle
- WHEN the cycle proceeds to send its reconcile request
- THEN the diagnostics outbox entry for that envelope already exists at the moment the request is sent, so a request that never returns still leaves the entry behind

### Requirement: Diagnostics Capture Does Not Depend On The Shared Local-Write Path

The system MUST durably capture a diagnostics outbox entry through a write path independent of the shared local-write coordination used for the app's primary database, so that failure or contention on that shared path does not prevent diagnostics capture.

#### Scenario: Capture succeeds while the primary write door is locked

- GIVEN another connection holds the write lock the primary database's shared write coordination would need
- WHEN a sync cycle durably captures its diagnostic envelope
- THEN the capture succeeds without waiting on or being blocked by that lock

### Requirement: Diagnostics Outbox Is Bounded And Evicts The Oldest Entry On Overflow

The diagnostics outbox MUST hold at most 100 undelivered entries. When capturing a new entry would exceed that bound, the system MUST evict the oldest entry as part of the same durable operation as the capture, so the bound is never transiently exceeded.

#### Scenario: Outbox at capacity evicts the oldest entry on the next capture

- GIVEN the diagnostics outbox already holds 100 entries
- WHEN a new envelope is durably captured
- THEN the oldest of the 100 existing entries is evicted
- AND the diagnostics outbox holds exactly 100 entries afterward, including the new one

#### Scenario: Outbox below capacity does not evict

- GIVEN the diagnostics outbox holds fewer than 100 entries
- WHEN a new envelope is durably captured
- THEN no existing entry is evicted
- AND the diagnostics outbox holds exactly one more entry than it did before

### Requirement: Delivery Is Attempted On Every Sync Cycle Regardless Of Trigger; Capture Is Restricted To Telemetry-Eligible Cycles

Every sync cycle, regardless of what triggered it, MUST attempt to deliver the diagnostics outbox's eligible undelivered entries. Capture of a new entry MUST occur only on a cycle that supplies a telemetry context, matching the existing conditions under which a `client_telemetry` envelope is built. These two behaviors are independent: a cycle ineligible to capture MUST still attempt delivery.

#### Scenario: A cycle without a telemetry context still attempts delivery of queued entries

- GIVEN the diagnostics outbox holds undelivered entries captured by earlier cycles
- WHEN a sync cycle runs without a telemetry context
- THEN that cycle attempts to deliver the diagnostics outbox's eligible undelivered entries

#### Scenario: A cycle without a telemetry context captures no new entry

- GIVEN a sync cycle runs without a telemetry context
- WHEN that cycle completes
- THEN no new diagnostics outbox entry is captured for that cycle

### Requirement: A Failed Delivery Attempt Does Not Fail The Sync Cycle

A delivery attempt for a diagnostics outbox entry that fails — whether by a thrown request or a non-2xx response — MUST leave that entry queued in the diagnostics outbox and MUST NOT cause the sync cycle itself to fail or abort.

#### Scenario: Delivery failure leaves the cycle's own outcome unaffected

- GIVEN a diagnostics outbox entry is eligible for delivery
- WHEN the delivery attempt for that entry throws or returns a non-2xx response
- THEN the entry remains in the diagnostics outbox, undelivered
- AND the sync cycle completes according to its own outcome, unaffected by the delivery failure

### Requirement: Delivery Is Idempotent Under Retry

Retrying delivery of a diagnostics outbox entry whose `cycle_id` was already accepted by the bridge in an earlier attempt MUST itself be treated as a successful delivery, and MUST NOT create a duplicate entry on the bridge or a delivery error on the device.

#### Scenario: Retrying an already-accepted cycle_id succeeds without duplication

- GIVEN a diagnostics outbox entry's `cycle_id` was already accepted by the bridge in a prior delivery attempt whose outcome the device never observed
- WHEN the device retries delivery of that same entry
- THEN the retry is treated as a successful delivery
- AND the entry is removed from the diagnostics outbox exactly once

### Requirement: Delivery Backoff Is A Persisted Not-Before Timestamp, Not A Timer

When a delivery attempt receives a response carrying a retry delay, the system MUST persist a not-before timestamp for that diagnostics outbox entry and MUST determine that entry's delivery eligibility solely by comparing the persisted timestamp against the clock at the start of a later sync cycle. The system MUST NOT implement this backoff as a timer or a sleep.

#### Scenario: A rate-limited entry is not retried before its not-before timestamp

- GIVEN a diagnostics outbox entry carries a persisted not-before timestamp from a prior rate-limited delivery attempt
- WHEN a sync cycle starts before that timestamp has passed
- THEN that cycle does not attempt to deliver that entry

#### Scenario: A rate-limited entry becomes eligible once its not-before timestamp has passed

- GIVEN a diagnostics outbox entry carries a persisted not-before timestamp
- WHEN a sync cycle starts at or after that timestamp
- THEN that entry is eligible for delivery in that cycle

### Requirement: The Degraded Tier Is Reported From A Single Source Of Truth

The `degraded` value describing which tier of the envelope was shed to fit the transport size budget MUST be produced by the same decision that performs the shedding. No other consumer of that value MUST recompute it independently.

#### Scenario: The reconcile body and the diagnostics outbox entry agree on the shed tier

- GIVEN a cycle's envelope is large enough that building it sheds a tier to fit the transport size budget
- WHEN that cycle's reconcile request body and its diagnostics outbox entry each report `degraded`
- THEN both report the same value, derived from the same shedding decision

### Requirement: The Envelope Is Dual-Written To The Existing Delivery Path And The Diagnostics Outbox

While the diagnostics outbox delivery path is in effect, the reconcile request body MUST continue to carry `client_telemetry` for a telemetry-eligible cycle exactly as it does today, and the same envelope MUST also be durably captured as a diagnostics outbox entry, with both carrying the same `cycle_id`.

#### Scenario: The reconcile body and the diagnostics outbox entry share one cycle_id

- GIVEN a telemetry-eligible sync cycle builds its `client_telemetry` envelope
- WHEN that cycle's reconcile request body and its diagnostics outbox entry are compared
- THEN both carry the same `cycle_id`

### Requirement: Capture Is Gated On The Same Conditions That Gate Building The Envelope

The system MUST capture a diagnostics outbox entry only under the same conditions that already gate building the `client_telemetry` envelope, including the user's sync telemetry preference. When the user has disabled that preference, the system MUST NOT capture a diagnostics outbox entry, even on a cycle that otherwise supplies a telemetry context.

#### Scenario: A disabled telemetry preference produces no diagnostics outbox entry

- GIVEN the user has disabled the sync telemetry preference
- WHEN a sync cycle that would otherwise supply a telemetry context runs
- THEN no diagnostics outbox entry is captured for that cycle
