# ODD — mobile sync: native engine and single-owner writes

**Status:** Open. Design decisions taken 2026-09-20. T1 done; T2 and T7 implemented and committed —
device acceptance still open, because until 2026-09-20 no attempt reached the engine.
**Supersedes:** `odd/tasks/background-sync-native-bound.md` (T1/T2/T4/T5/T7/T8/T9 carry over with new
outcomes), `odd/tasks/background-sync-handoff-bound.md` (retired), `odd/tasks/sync-cycle-checkpoint-wiring.md`
(closed by the first commit of this feature).
**Architecture:** `docs/mobile-sync-architecture.md` — the decisions in its §7 are the source of scope here.
**Evidence base:** `docs/mobile-background-sync-investigation-log.md`.

## Why

With the app closed, the sync cycle parks forever inside a write and nothing closes: **41 consecutive
`never_closed` attempts**, each ended by the platform at ~600 s, with the app pushed into Android's
`RESTRICTED` stand-by bucket. The device measurements and the pattern diagnosis are in the architecture
document (§3, §4); this document is the execution plan that follows from them.

Four decisions frame every task below (architecture doc §7):

1. **The engine moves native (Kotlin).** No JS timer remains on the sync path.
2. **No resident service by default.** The bridge's availability window is a profile, not a constant, so
   the app must be cheap while the bridge is absent without knowing the schedule.
3. **Full ownership target:** journal in its own file, sync store separated, and the process-wide
   file-keyed write door replaced by a single-writer actor per store with lease and fencing.
4. **Liveness is a native watchdog plus journal recovery.** Restoring the `HeadlessJsTask` registration
   is retired, because nothing on the sync path depends on JS timers any more.

## Goal

The app delivers pending operations within the first hour the bridge is reachable again — after any
absence, however long — without the user opening the app, and no attempt can occupy a job silently.

## Non-goals

- Rewriting the foreground apply logic. In `staged` mode the background cycle never writes `animes`;
  the foreground drain keeps that job.
- Changing the bridge protocol or the outbox semantics.
- Touching the UI beyond the status surface the journal feeds.

## Tasks

### T1 — ADR amendment for the native boundary
- Surface: `docs/adr/` (new ADR or an amendment to 007), `docs/mobile-sync-architecture.md`.
- Requirement: record that a background engine may be native, what it owns (transport, claim, staging,
  cursor, prune, journal) and what stays in TS (domain apply on the foreground). ADR 007 decision 3
  (policy separated from mechanism) is preserved and becomes the seam the policy lives on.
- Evidence: the ADR text, and the architecture doc pointing at it.

### T2 — S1: native journal with recoverable attempt state
- Surface: the native module that will host the engine, plus its manifest/schema.
- Requirement: append-only journal in its **own file and connection**, one row per transition
  (`cycle_id`, `from`, `to`, `at`, `attempt_seq`, `reason`), for the states in architecture doc §6.2.
  No behaviour change to sync in this slice.
- Evidence: focused tests for the journal store; on device, a parked attempt leaves a readable state.

### T3 — S2: native watchdog and the `abandoned` outcome
- Surface: the native module.
- Requirement: a bound that lives outside the guarded work and can abandon it, plus an abandon record a
  parked store write cannot skip. The OS job stop remains the outer backstop.
- Evidence: focused tests; on device, zero `Client timed out while executing` stops in 24 h and the
  parked attempt ends as `abandoned`.

### T4 — S3: recovery sweep
- Surface: the native scheduler/policy component.
- Requirement: on any trigger, reclaim a stale state — release the lease, return the batch to `pending`,
  mark `abandoned`. Invariant 2 of architecture doc §6.2 is the acceptance.
- Evidence: the two orphan `processing` rows from the live device return to `pending` with no user
  action; the stale `sync_cycle_lock` lease is released.

### T5 — S4: single-writer actor per store, and the sync store separated
- Surface: the native module; the TS store boundary.
- Requirement: one writer per store with a recorded owner, a lease with expiry and fencing;
  the sync-critical state leaves the UI's store so a parked UI write cannot delay an attempt, or the
  reverse. The file-keyed door stops being the app's global arbiter.
- Evidence: a parked UI write does not delay an attempt (device test), and a reclaimed lease rejects the
  previous owner's writes (focused test).

### T6 — S5: presence gate and attempt policy
- Surface: the native policy component; the persisted presence fact.
- Requirement: presence is a persisted fact the background can read; no presence means no state entered
  and no write issued. Backoff with jitter is ours (the Expo background API exposes only an interval).
- Evidence: with the bridge absent, an attempt costs `< 2 s` and writes nothing, measured on device.

### T7 — S6: the native engine
- Surface: the native module.
- Requirement: read outbox → claim → HTTP → map the wire response → stage into
  `pending_remote_changes` → advance cursor → prune → journal. No `bridge_changes` apply to domain
  tables. In `staged` mode the background cycle DOES write `animes` through the OCC token path —
  `persistConfirmedAnimeTokens` and, per conflict outcome, `applyAnimeBridgeToken`, each a single
  `UPDATE animes SET bridge_modified_at = ?` on a column disjoint from the domain ones — so those
  token writes are part of this task's scope: the engine must own them under the cycle lease
  (perform, defer, or re-home them), never skip them.
- Evidence: the wire mapping is diffed against the captured bodies before the JS path is retired
  (architecture doc §10); on device, a closed app closes a cycle; on device, the engine's only
  `animes` write is the `bridge_modified_at` token update.

### T8 — S6b: retire the JS background scaffolding
- Surface: `src/features/sync/**`, `app.json`, `modules/foreground-sync-ticker`.
- Requirement: `expo-background-task`, the native ticker and the JS background bounds leave the sync
  path once T7 is observable.
- Evidence: the diff, and the acceptance metrics still holding afterwards.

### T9 — Acceptance on device
- Surface: none (measurement).
- Requirement: architecture doc §9, first row included: catch-up within the first hour of reachability
  without opening the app, for a long absence as well as a short one.
- Evidence: journal, outbox, `dumpsys jobscheduler`, `am get-standby-bucket`, recorded in the log either
  way — including the counter-case.

## Sequence

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. T2 before T3 is deliberate: if an attempt cannot report,
the next attempt's sweep must be able to recover it from durable state, and that requires the journal
first. T5 may run in parallel with T3/T4 only if the store split lands before T7.

## Acceptance

- No attempt ends without a terminal journal state (`closed`, `failed`, `abandoned`).
- `consecutive_unclosed_cycles` stays 0 for 24 h with the app closed.
- Zero JobScheduler `Client timed out` stops for the app, and the stand-by bucket is not `45`.
- A no-op attempt costs milliseconds with the bridge absent.

## Checks

- Focused: `npx jest <focused paths> --maxWorkers=4`
- Gate: `npx lefthook run pre-commit` with the files staged
- Types: `npx tsc --noEmit`
- Native: a rebuild is required for every Kotlin slice before T9 can observe anything

## Work units

One commit per task, Conventional Commits, tests and docs alongside the behaviour. Commits are prepared
and held until the maintainer confirms, per `AGENTS.md`.

## Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | done | `docs/adr/008-native-sync-engine-and-single-owner-writes.md` — accepted 2026-09-20; amends ADR 007 by keeping its decisions 1, 2, 3, 4 and 6 while changing the substrate and the ownership mechanism, records the device evidence that closed 007's own gate, and puts four invariants in force. |
| T2 | implemented, committed — device acceptance open | `sync-journal` local module, implemented and committed; confirmed in the binary by `npx expo-modules-autolinking search --platform android` (2026-09-20). **Device acceptance still open: until 2026-09-20 no attempt reached the engine, so no journal row has ever been written on device.** |
| T3 | pending | |
| T4 | pending | Ground truth for the sweep: 2 orphan rows in `processing`, `sync_cycle_lock` owner `headless_cycle` expired, `is_cycle_active = 1` (§3.5 of the architecture doc). |
| T5 | pending | |
| T6 | pending | |
| T7 | implemented, committed — device acceptance open | Engine implemented and committed; invocation now provable (`cf71725`: `SyncEngine: runOnce invoked (...)` before anything else, completion line with outcome/stage/elapsed, once-per-runtime JS warning when the native module is missing) and reachable from the active path (`e038901`: the tick tries the engine first under `execution_mode = android_foreground_service`). **Device acceptance still open: until 2026-09-20 no attempt reached the engine.** |
| T8 | pending | |
| T9 | pending | |

### Device acceptance checklist (next run)

Until 2026-09-20 no attempt reached the engine, so none of these has ever been observed on device.
The next device run must show, each with its instrument:

- [ ] Ticker wake lock present — `dumpsys power` shows `ForegroundSyncTicker:ticking` while the
      service is up.
- [ ] `SyncEngine: runOnce invoked (...)` in logcat.
- [ ] `files/sync-journal.db` created with transition rows.
- [ ] `last_attempt_at` fresh.
- [ ] The attempt bounded to 30 s instead of dying at 600.

Trigger constraints, one line each: the `expo-background-task` worker only executes its task with the
app in the background (a foreground run is skipped by the library's own guard and reschedules in
15 minutes); the service ticker runs with the app alive. Note also that a `production`-profile build
is not debuggable, so the device run must use the `lab` profile for `run-as` reads of the journal.
