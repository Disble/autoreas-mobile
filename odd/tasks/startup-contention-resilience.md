# startup-contention-resilience

Feature: stop presenting a transient SQLite lock wait as a fatal startup failure, and make every
terminal startup failure visible.

Status: T1–T4 implemented, verified and committed on `feat/startup-contention-resilience` —
`cf37139` and `e47ac70` carry the implementation, followed by this document's commit; each commit
passed the real gate (`npx lefthook run pre-commit`). T5 deferred.

## Why

Reported by the maintainer on the installed `1.4.0` build (tablet `R52T30686RV`, `versionCode=10`,
release APK, not debuggable): "after a database loading screen that took a long time, an error
screen appeared", intermittently, "since the last release", most likely "just after updating". The
device had already closed the logcat buffers, so the in-app diagnostic is the missing evidence.

Read-only investigation of the shipped code (`dev` == `v1.4.0` for `src/infrastructure/db` and
`src/features/startup`: the only commit after the tag is a docs commit) found an ordering defect
that explains it by construction:

- `STARTUP_LOCAL_OPERATION_DEADLINE_MS` and `SQLITE_BUSY_TIMEOUT_MS` both held `5_000`.
  `prepareForegroundDatabase` applies `PRAGMA busy_timeout = 5000` as its FIRST statement, so the
  connection was authorized to spend its entire lock-wait allowance inside an operation that
  `withStartupDeadline` declared failed at the same instant. **Zero headroom:** a transient wait
  could never resolve and was guaranteed to reach the user as the fatal card.
- `STARTUP_PROVIDER_READINESS_DEADLINE_MS` was a second, independent `5_000` budget reaching the
  same card, emitting **no log at all**, which is why this incident left no trace.
- `Promise.race` does not cancel: the database work keeps running and often succeeds while the user
  is told the app failed.

Measured work (real SQLite, 17.5 MiB database, 30 000 `operation_log` rows):
`PRAGMA quick_check` 35.3 ms, `ALTER TABLE sync_cycle_lock ADD COLUMN fence TEXT` 2.5 ms,
`PRAGMA journal_mode = WAL` 3.1 ms, 5× `PRAGMA table_info` 0.1 ms. The whole validate + repair path
is tens of milliseconds, so the observed seconds are a **wait**, not work.

Two further findings:

- `createStartupDiagnostic` already computed `classification`, and **nothing read it**: a transient
  `busy` was presented exactly like permanent corruption.
- A verification pass then found a second, deeper defect the first fix created: the local budget
  was applied PER OPERATION (preparation 20 s, then the configuration read another 20 s), so its
  worst case was 40 s under a 25 s watchdog. The watchdog could preempt work still inside its own
  budget and report a `provider_readiness` fatal card for a progressing startup.

Not reproduced on demand: 8 cold starts and 3 forced WorkManager collisions
(`adb shell cmd jobscheduler run -f <pkg> 285`) all started cleanly. The trigger is
timing-dependent, which is why this task fixes the defect by construction.

## Goal

A transient lock wait during local startup is waited out and, if it resolves, the app opens
normally. A genuinely permanent failure still stops startup, immediately and with a logged,
structured diagnostic. When startup does fail, the failure is always readable after the fact.

## Non-goals

- **No change to the native engine, its lease, or schema-window writer ordering** (T5).
- No change to `STARTUP_FONT_LOAD_DEADLINE_MS`: font loading is not lock-bound.
- No manual "retry" control in the loading UI; the soft phase names closing and reopening as the
  escape, which the existing recovery hint already does.
- No change to `busy_timeout` on the native engine's own connection (`APP_DB_BUSY_TIMEOUT_MS`),
  which is a separate process-boundary decision.
- No new stage or phase vocabulary, and no new `StartupState` field.
- **No `tests/sqlite-lab` arm was added for this change, deliberately.** The change's central claim
  is arithmetic, and both halves are already evidenced elsewhere: scenario `h02` establishes that a
  `busy_timeout = 5000` connection really waits ~5 s under contention (a no-pragma connection fails
  in ~0 ms), and `startup-budget-ordering.test.ts` establishes that 5 000 < 8 000 < 20 000 < 25 000.
  Together they imply the wait now fits inside the outer budget. A new lab scenario would restate
  that with a manually mirrored constant, and it cannot exercise the app's own deadline wrapper.

## Decisions (as implemented)

- **Ordering rule**, enforced by `tests/features/startup/__tests__/startup-budget-ordering.test.ts`:
  `SQLITE_BUSY_TIMEOUT_MS (5_000) < STARTUP_SOFT_DEADLINE_MS (8_000) < STARTUP_LOCAL_OPERATION_DEADLINE_MS (20_000) < STARTUP_PROVIDER_READINESS_DEADLINE_MS (25_000)`.
  The inner wait is left at 5 000: the defect was never that it was too large, only that the outer
  budget equalled it. Fixing the outer budget keeps the diff off five literal `PRAGMA busy_timeout`
  assertions and keeps the Kotlin mirror comment truthful.
- **One budget, shared (deadline propagation).** `createStartupDatabaseInitializer` computes one
  absolute `localReadinessDeadlineAt` per invocation; preparation (including its retries) and the
  configuration read each receive `localReadinessDeadlineAt - Date.now()` as their remaining
  budget. The watchdog strictly envelopes the whole local sequence instead of racing it.
- **Two phases, one budget.** 8 s is the soft boundary at which the loading card says it is taking
  longer than usual; 20 s is the hard, terminal boundary. The soft boundary never selects the
  failure card and never writes `StartupState`.
- **Policy from classification.** Only `classification === 'busy'` retries; `corruption`,
  `incompatible_schema`, `schema_validation` and `sqlite` fail fast. **`unknown` is NOT retried** —
  a deliberate reversal of this task's original proposal: `unknown` is not treated as permanent, but
  spending the remaining budget waiting on an unidentified error is a guess, not a policy.
- **Retry belongs to the caller**, bounded by `STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS = 4` and by
  a STRICT remaining-budget check, so a retry only starts when one full wait fits with room to
  spare. A superseded request does not retry.
- **The silent path gets an instrument**: the hook logs every terminal failure it creates itself
  (`font_loading`, `provider_readiness`) once per distinct stage, while `startup.helpers.ts` keeps
  logging the preparation and configuration diagnostics it creates itself. No stage is logged twice.

## Verification split (why this needs two harnesses)

`jest-expo` mocks `expo-sqlite`, so **no Jest test can observe a lock, a pragma, or a transaction**
(`openspec/changes/archive/2026-08-12-sqlite-write-lock-contention/design.md:96`). This change
therefore verifies call shape, state transitions and policy in Jest, and inherits its real-SQLite
lock evidence from the existing lab scenarios rather than claiming device behaviour it does not
have.

## Tasks

### T1 — Order the budgets and make the ordering executable

Status: done. `STARTUP_LOCAL_OPERATION_DEADLINE_MS` 5_000 → 20_000, new
`STARTUP_SOFT_DEADLINE_MS = 8_000`, `STARTUP_PROVIDER_READINESS_DEADLINE_MS` 5_000 → 25_000,
`SQLITE_BUSY_TIMEOUT_MS` unchanged at 5_000.

Evidence: `tests/features/startup/__tests__/startup-budget-ordering.test.ts`, written FIRST and run
against the original values — 4 failed, one printing `Expected: < 5000, Received: 5000`. After the
change: 4 passed.

### T2 — Soft phase observes, hard phase fails

Status: done. `useStartupSlowNotice` owns the 8 s timer and its flag;
`StartupBoundaryLoading` gains `isTakingLongerThanExpected` and renders one extra muted line; the
hard deadline stays the only path to `fatal`.

Evidence: integration tests "shows the slow-startup notice after the soft deadline without selecting
the failure card" and "removes the slow-startup notice once startup becomes ready even after the
soft deadline elapsed". RED observed first (both failed with the new copy never rendered).

### T3 — Drive policy from classification

Status: done. `isRetryableStartupDiagnostic` + `prepareWithBoundedRetry` with the attempt cap, the
strict remaining-budget check, and the superseded-request gate.

Evidence: an 8-case classification matrix (`startup.helpers.test.ts`), plus `use-startup.test.ts`
covering a transient failure that becomes ready on the second attempt, a `schema_validation`
failure that never retries, an attempt-cap stop, and the shared-budget contract (written first and
observed failing: at the shared-budget instant the state was still `loading_config` because the old
code granted the configuration read a fresh budget).

### T4 — No silent terminal startup failure

Status: done. `useStartupFailureLogs` emits exactly one `console.error(STARTUP_FAILURE_LOG_PREFIX,
diagnostic)` per distinct hook-created stage.

Evidence: integration tests asserting exactly one log for `provider_readiness` and for
`font_loading`, with the redaction contract re-asserted (RED observed first: both `toHaveLength(1)`
received 0).

### T5 — Single-writer ordering for the schema window (deferred, frozen contract)

Status: deferred — not implemented. The foreground prepares the schema through expo-sqlite while the
native engine holds `BEGIN IMMEDIATE` on the same file through the framework SQLite, outside the JS
write door (`WRITE_QUEUE_BY_DATABASE` is process-local and cannot see it). Frozen contract: schema
preparation is a critical section that must exclude every other writer, coordinated through a
mechanism the engine already honours (`sync_cycle_lock` carries a per-claim `fence` since 1.4.0).

Blocked by: no Kotlin test harness in this repository, and acceptance requires a physical-device run
of the engine against a migrating database.

## Verification record

- RED → GREEN per task, with the failing output recorded before each implementation (T1, T2, T3, T4).
- **Mutation check** on the central guard: staging the green implementation and forcing
  `isRetryableStartupDiagnostic` to `return true` failed exactly "never retries a permanent schema
  validation failure"; restored from the index with `git checkout -- <file>` per `AGENTS.md`.
- **Test-integrity check** of the integration file, which received a large formatting compaction:
  `it(` count 9 → 13 (additions only), a name-set diff showing no deletion or rename, and **zero
  deleted `expect(` lines**. Every removed non-blank line was classified as formatting/prop
  reflow.
- **Independent verification** (`gentle-ai-verify`, read-only) confirmed items 1–6 of its brief and
  found: the shared-budget envelope defect (fixed: deadline propagation), an inclusive retry
  boundary that could race the outer deadline (fixed: strict comparison), a superseded request
  still retrying (fixed), and that this document contradicted the implementation (fixed here).
- **The real gate**: `npx lefthook run pre-commit`. It first FAILED, on the `fallow` lane only.
  Bisected by reverting path subsets: clean tree → exit 0; full change → exit 1; reverting only
  `src/features/startup` → exit 0. The audit named a single new violation in the whole repository —
  `useStartupBoundary` at 19 cognitive complexity. Fixed by extraction, not suppression:
  `useStartupSlowNotice` and `useStartupFailureLogs` as independent hooks, the failure construction
  and resolution chain as pure helpers. Final run: **exit 0** — `fallow` 1.30 s, `lint` 22.18 s,
  `typecheck` 24.44 s, `test` 43.02 s (180 suites / 1375 tests), `test:mutation:staged` passed.

## Review workload

`14 files changed, 893 insertions(+), 114 deletions(-)`: 9 source files (−45/+338), 4 test files
(−69/+381), 1 task document (+174). Over the 400-line review budget, so the slices matter: read
`src/features/startup/startup.helpers.ts` and the two new hooks for behaviour, and treat the
`StartupBoundary.integration.test.tsx` churn as formatting except for the five added tests. The
actual commit split is (1) `cf37139` — the timing and policy core: the budget constants, the
executable ordering invariant, the shared local budget, and the retry policy that consumes the
attempt cap; (2) `e47ac70` — the presentation and observability half: the soft-deadline notice, the
one-shot terminal-failure logging, and the extraction that brought `useStartupBoundary` back under
the complexity threshold; (3) `da277a4` — this document. The earlier idea of a constants-only first
commit was measured and rejected: with `STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS` declared and no
reader, `bun run audit` exits 1 on `Unused exports`, so (1) had to include the retry policy — the
alternative was rejected on measurement, not assumption.

## Honest limits

- The original device incident was never reproduced, so the causal chain is argued from the
  ordering defect and the measured work, not from an observed failure.
- No Jest test in this repository can observe a real lock (mocked `expo-sqlite`), and no device run
  of this change has happened.
- `STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS = 0` would make the retry loop fall through and report
  success. Unreachable at 4, and guarded only by the call-count test.
- The configuration read is still a single attempt: a transient `busy` there remains terminal
  (logged, with the accurate classification).
- `src/features/startup/ui/StartupBoundary/StartupBoundaryFallback.tsx` carries a pre-existing
  `jsx-max-depth` warning. It is untouched and unstaged, so the gate's staged-file lint does not
  see it; fixing it is a separate, unrelated edit.
