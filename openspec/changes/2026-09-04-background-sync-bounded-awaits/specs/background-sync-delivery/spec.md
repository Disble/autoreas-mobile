# Background Sync Delivery Specification

## Purpose

A reconcile cycle currently has no bound at any layer: bridge requests await `fetch` with no `AbortSignal`, the cycle has no deadline, and the host `defineTask` callback can await the cycle forever — matching a measured host job that hangs until platform-level termination with zero cursor progress. This capability bounds every layer on that path: a request-level timeout on `BridgeClient`, a cycle deadline strictly under the host's runtime limit, a host callback that always settles, and a scheduler interval expressed in the unit the host contract requires.

## Requirements

### Requirement: Bounded Bridge Request

Every `BridgeClient` HTTP request MUST apply a request timeout via `AbortSignal`. Callers MUST be able to override the timeout per request through `BridgeRequestSpec`; when no override is given, a safe default MUST apply. When the timeout elapses before a response arrives, the request MUST reject with a typed failure whose underlying reason identifies it as a timeout abort, distinguishable from other unreachable causes (DNS failure, connection refused).

#### Scenario: Default timeout aborts a hung request

- GIVEN a `BridgeClient` request is issued without a per-request timeout override
- AND the transport never resolves the underlying `fetch` call
- WHEN the default timeout elapses
- THEN the request promise rejects with a failure whose reason identifies a timeout abort

#### Scenario: Per-request override changes when the abort fires

- GIVEN a caller sets a custom `timeoutMs` on the request spec, shorter than the safe default
- WHEN that custom duration elapses before the transport resolves
- THEN the request aborts at the custom duration, not the default

#### Scenario: A fast response is unaffected by the timeout

- GIVEN a request resolves well within the default timeout
- WHEN the response arrives
- THEN the request settles normally with no abort side effect

### Requirement: Reconcile Cycle Deadline

The reconcile cycle MUST enforce a deadline strictly less than the host background-task runtime limit. When the deadline elapses before the cycle's work completes, the cycle MUST terminate with a typed failure outcome instead of remaining pending indefinitely.

#### Scenario: Cycle deadline is bounded by the host limit

- GIVEN the configured cycle deadline and the host job's documented runtime limit
- WHEN the two are compared
- THEN the cycle deadline is strictly less than the host runtime limit

#### Scenario: A hung cycle still reaches a terminal outcome

- GIVEN the reconcile cycle's underlying work never settles on its own
- WHEN the cycle deadline elapses
- THEN the cycle produces a terminal, typed failure outcome instead of an indefinitely pending promise

### Requirement: Host Completion Signal

The `defineTask` callback registered for the background sync task MUST always settle with a `BackgroundTaskResult` value on every code path, including when the reconcile cycle it invokes hangs past its own deadline.

#### Scenario: Host receives a result even when the cycle hangs

- GIVEN the reconcile cycle invoked by the task callback never settles on its own
- WHEN the task callback runs to completion
- THEN it returns a `BackgroundTaskResult` (`Success` or `Failed`) instead of leaving the host awaiting indefinitely

#### Scenario: Normal success path still signals success

- GIVEN a reconcile cycle completes successfully within the cycle deadline
- WHEN the task callback resolves
- THEN it returns `BackgroundTaskResult.Success`

### Requirement: Scheduler Interval Unit Correctness

`BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval` MUST be expressed in the unit the host scheduler contract requires (minutes), and MUST equal 15.

#### Scenario: minimumInterval is configured in minutes, not seconds

- GIVEN the host scheduler contract expects `minimumInterval` in minutes
- WHEN `BACKGROUND_SYNC_TASK_OPTIONS` is read
- THEN `minimumInterval` equals `15`
- AND it is not the seconds-scaled value `15 * 60`
