# Delta for Local Write Serialization

## ADDED Requirements

### Requirement: No Unbounded I/O Inside a Write Door

The system MUST prevent an unbounded asynchronous call (a bridge/network request with no bound of its own) from being placed inside a `withLocalWrite` task callback. A deterministic, static boundary check MUST flag such a call as a violation before it reaches runtime, sibling to the existing write-door boundary check.

#### Scenario: A write-door task with only SQLite statements passes the check

- GIVEN a `withLocalWrite` task callback that only calls statement methods on its `tx` handle
- WHEN the deterministic boundary check runs against that file
- THEN no violation is reported

#### Scenario: A bridge call inside the door is flagged as a violation

- GIVEN a `withLocalWrite` task callback that calls a bridge/network method (for example `bridgeClient.reconcile`)
- WHEN the deterministic boundary check runs against that file
- THEN the call is flagged as a violation
- AND the violation message identifies the write door as the reason

### Requirement: Write Door Deadline Rejects the Caller Without Opening the Door

The system MUST apply a deadline to the task running inside a `withLocalWrite` transaction. When that deadline elapses, `withLocalWrite` MUST reject the calling caller's promise with a typed door-timeout failure. This deadline MUST NOT permit a subsequently queued write to the same database file to begin its own task (and therefore its own `BEGIN IMMEDIATE`) while the stalled transaction remains open on the connection — the door stays closed; only the caller is rejected.

#### Scenario: A stalled write rejects its own caller at the deadline

- GIVEN a `withLocalWrite` task never resolves or rejects
- WHEN the write-door deadline elapses
- THEN the caller's promise rejects with a typed door-timeout failure

#### Scenario: The door stays closed — a second writer to the same file is never admitted

- GIVEN a stalled write has already rejected its own caller with a door-timeout failure
- AND a second write to the SAME database file is queued behind it
- WHEN time advances arbitrarily far past the door deadline
- THEN the second write's task callback is never invoked
- AND the second write's promise remains unsettled, neither resolved nor rejected

#### Scenario: A write that completes before the deadline is unaffected

- GIVEN a `withLocalWrite` task resolves well within the door deadline
- WHEN the transaction commits
- THEN the caller's promise resolves normally and the deadline never fires
