# Delta for Mobile Sync Runtime

## ADDED Requirements

### Requirement: Root-level sync runtime

The system MUST initialize the sync runtime from the app root after SQLite bootstrap resolves a paired `bridge_config`.

#### Scenario: Paired cold start mounts sync runtime
- GIVEN SQLite boot completed and `bridge_config.device_id` exists
- WHEN the root layout finishes initialization
- THEN the sync runtime MUST start without waiting for `AnimeListScreen`
- AND reconcile/WebSocket ownership MUST belong to that runtime

#### Scenario: Unpaired boot stays idle
- GIVEN no paired bridge configuration exists
- WHEN the app boots
- THEN the sync runtime MUST NOT register background sync or open WebSocket

### Requirement: Availability-triggered reconcile

The system MUST attempt reconcile automatically when sync availability improves.

#### Scenario: App returns to foreground
- GIVEN the device is paired and the app was in `background`
- WHEN `AppState` changes to `active`
- THEN the runtime MUST trigger reconcile
- AND it MUST preserve pending operations if the bridge is unreachable

#### Scenario: Connectivity recovers
- GIVEN the device is paired and local pending operations exist
- WHEN network state changes from disconnected to connected
- THEN the runtime MUST trigger reconcile automatically
- AND concurrent triggers MUST collapse into one in-flight sync cycle

### Requirement: Periodic background reconcile task

The system MUST register a periodic background task for paired devices and execute reconcile headlessly using persisted SQLite state.

The system MUST treat this mechanism as best-effort OS scheduling and MUST NOT claim guaranteed synchronization after the user explicitly kills the app process.

#### Scenario: Background task with valid pairing
- GIVEN the device is paired and the OS runs the background task
- WHEN the task opens the local database
- THEN it MUST execute the reconcile workflow using persisted bridge credentials
- AND it MUST return a success result only when the cycle completes without throwing

#### Scenario: Background task without pairing
- GIVEN no valid `bridge_config` exists
- WHEN the OS runs the background task
- THEN the task MUST exit as a no-op
- AND it MUST NOT create fake sync success state

#### Scenario: Background task network failure
- GIVEN pending operations exist and the bridge is unreachable
- WHEN the background task runs
- THEN pending rows MUST remain retryable (`pending` or existing failure policy)
- AND the task MUST report failure/no-data without corrupting the outbox

#### Scenario: User explicitly terminates the app
- GIVEN the device is paired and background sync was previously registered
- WHEN the user explicitly kills or swipes away the app process
- THEN the system MUST treat periodic sync as no longer guaranteed by the OS
- AND the product surface MUST NOT promise continued synchronization until the app is launched again

### Requirement: Background sync status visibility

The system MUST expose observable runtime/background sync status in Settings for paired devices.

#### Scenario: Paired settings shows runtime state
- GIVEN the device is paired
- WHEN the user opens Settings
- THEN the screen MUST show whether background sync is registered or unavailable
- AND it MUST show the latest known local sync attempt metadata

#### Scenario: Last failure is visible
- GIVEN the latest runtime or background sync attempt failed
- WHEN the user opens Settings
- THEN the screen MUST show the latest known failure message or status
- AND it MUST NOT require logs or a debugger to inspect the problem

## MODIFIED Requirements

### Requirement: WebSocket lifecycle ownership

The system MUST keep WebSocket realtime sync as a foreground-only channel owned by the root sync runtime, not by a single catalog screen.

#### Scenario: Screen-independent realtime sync
- GIVEN the user is on any paired route inside the app shell
- WHEN the app is active
- THEN the runtime MUST keep WebSocket eligibility independent from `AnimeListScreen` mounting
- AND background transition MUST still close the socket explicitly

### Requirement: Reconciler triggers

The system MUST support reconcile from manual refresh, local mutation tail-sync, foreground resume, connectivity recovery, WebSocket `sync_required`, and periodic background execution.

#### Scenario: Duplicate trigger storm
- GIVEN multiple trigger sources fire close together
- WHEN one reconcile is already in flight
- THEN later triggers MUST reuse or queue the guarded cycle
- AND the system MUST NOT run overlapping reconcile writes on the same database
