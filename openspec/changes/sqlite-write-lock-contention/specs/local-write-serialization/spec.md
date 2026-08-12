# Local Write Serialization Specification

## Purpose

Local SQLite writes on-device MUST go through a single write door per database file so concurrent writers cannot race each other into `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT`, and a connection that becomes unreachable through a failed close MUST NOT become a permanent, undetectable lock holder.

## Requirements

### Requirement: File-Keyed Write Serializer

The system MUST route every write to a given SQLite database file through a single serializer keyed by the database file's identity, not by connection object identity.

#### Scenario: Concurrent writers queue behind one serializer

- GIVEN two independent write operations target the same database file
- WHEN both are submitted concurrently
- THEN the serializer executes them one at a time in submission order
- AND under measured contention no write fails with `SQLITE_BUSY` or `SQLITE_BUSY_SNAPSHOT`

#### Scenario: A write bypassing the serializer is a defect

- GIVEN a write path calls the raw database connection directly instead of the file-keyed serializer
- WHEN that write executes concurrently with a serialized write to the same file
- THEN the bypassing write reintroduces lock-contention failures
- AND a deterministic boundary check MUST flag the direct call as a violation

### Requirement: Open-Time Connection Policy

Every write-capable SQLite connection MUST receive its `busy_timeout` (and the project's WAL configuration) at the moment it is opened, including connections the application does not open through its documented startup path.

#### Scenario: Implicitly-opened connection inherits the timeout

- GIVEN a code path opens a new write-capable connection outside the documented startup sequence
- WHEN that connection writes while another writer holds the lock
- THEN it waits up to the configured `busy_timeout` before failing
- AND it does not fail instantly with a zero-timeout error

#### Scenario: A connection without the policy fails fast instead of waiting

- GIVEN a connection is created without the open-time policy applied
- WHEN it attempts a write while the lock is held
- THEN the write fails immediately with no wait
- AND this contrast is why the policy MUST apply at open time, not afterward

### Requirement: Upfront Write-Lock Acquisition

Write transactions MUST acquire the write lock immediately at transaction start (`BEGIN IMMEDIATE` or equivalent), invoked through the asynchronous database API, before any synchronous statement in that transaction executes.

#### Scenario: Busy wait does not block the JS thread

- GIVEN a write transaction begins while another writer holds the lock
- WHEN the transaction requests the write lock through the async API
- THEN the wait for the lock happens off the JS thread
- AND synchronous statements in the transaction run only after the lock is acquired

#### Scenario: Deferred BEGIN no longer bypasses the busy handler

- GIVEN a transaction reads a row and then writes to that same row
- WHEN another connection commits a conflicting write between the read and the write
- THEN the transaction MUST NOT receive an instant `SQLITE_BUSY_SNAPSHOT` without invoking the busy handler
- AND it instead waits for the lock via the upfront `BEGIN IMMEDIATE` acquisition

### Requirement: Reachable, Closable Connections

A connection whose `close()` call fails or rejects MUST remain reachable by the runtime and MUST remain closable on a subsequent attempt; the runtime MUST NOT drop its own reference to a connection before that connection is confirmed closed.

#### Scenario: A failed close stays retriable

- GIVEN a connection's close attempt rejects
- WHEN the runtime still holds a reference to that connection
- THEN a later close attempt on the same connection can succeed
- AND that success releases any lock the connection was holding

#### Scenario: No silent replacement while the old connection is still open

- GIVEN a close attempt on a write-capable connection fails
- WHEN the runtime subsequently needs a write-capable connection for the same role
- THEN it MUST NOT silently open a new connection while the failed-to-close connection remains open
- AND it MUST instead surface the failure or retry against the still-open connection

### Requirement: Chapter Mutation Succeeds Under Contention

A user-initiated chapter mutation (the `+`/`-` chapter buttons) MUST succeed under the levels of write contention observed in production, rather than surfacing a locked-database error to the user.

#### Scenario: Chapter tap succeeds under measured contention

- GIVEN concurrent background writers are active at a contention level equivalent to the reference harness's dose-response arms
- WHEN the user taps a chapter `+`/`-` button
- THEN the mutation completes successfully
- AND the user does not see a "database is locked" failure toast
