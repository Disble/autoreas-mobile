# Delta for Sync Diagnostics Delivery

## ADDED Requirements

### Requirement: Delivered Count Requires A Confirmed Delete Of The Outbox Entry

When a delivery attempt receives a 2xx response, the system MUST count that entry as delivered only if the subsequent removal of its outbox entry is confirmed to have succeeded. When that removal is not confirmed, the entry MUST remain queued, MUST NOT be counted as delivered, and the write failure MUST be reflected in an observable count distinct from `delivered`.

#### Scenario: A confirmed delete after a 2xx response counts as delivered

- GIVEN a diagnostics outbox entry receives a 2xx response
- WHEN its outbox entry's removal is confirmed to have succeeded
- THEN the flush result counts that entry as delivered

#### Scenario: A failed delete after a 2xx response is not counted as delivered

- GIVEN a diagnostics outbox entry receives a 2xx response
- WHEN its outbox entry's removal fails
- THEN the flush result does not count that entry as delivered
- AND the entry remains queued, and the write failure is reflected in an observable count

### Requirement: A Permanently Rejected Envelope Is Reported Distinctly From A Deferred One

When a delivery attempt receives a response the system classifies as a permanent envelope rejection, that outcome MUST be reported as its own count, separate from `delivered` and separate from entries left queued by a transient failure, so a discarded report is distinguishable from one still pending redelivery.

#### Scenario: A rejected envelope is not counted as delivered

- GIVEN a diagnostics outbox entry receives a response classified as a permanent envelope rejection
- WHEN the flush completes
- THEN the flush result does not count that entry as delivered

#### Scenario: A rejected envelope's discard is reported separately from a deferral

- GIVEN one entry is permanently rejected and another is left queued by a transient failure in the same flush
- WHEN the flush result is read
- THEN the rejected entry's discard and the deferred entry's queued state are reported as distinct, separately countable outcomes
