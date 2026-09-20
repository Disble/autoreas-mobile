# sync-cycle-checkpoint-wiring

Feature: wire the existing (but uncalled) sync-cycle checkpoint instrument so a hung background
cycle reports the stage it died in, out of band, on a connection that survives the jam.

## Why

Measured on the device (Samsung SM-X800, Android 15, `com.disble.autoreasmobile` 1.3.0, installed
`2026-09-15 23:36:32`), reproduced on demand with
`adb shell cmd jobscheduler run -f -n androidx.work.systemjobscheduler <pkg> <jobId>`:

- Every background job ends in JobScheduler `timeout`, never `successful_finish`; the next job
  starts 127 ms later. 600.0 s of budget burned per iteration, 33 iterations in one day.
- `sync_runtime_status` reads `is_cycle_active = 1`, `last_cycle_stage = attempt_started`, and
  `consecutive_unclosed_cycles` climbing.
- `last_backlog_read_count` and `last_oldest_pending_age_ms` stay frozen across 35 minutes, and the
  device opens **no socket** to the bridge, so the cycle hangs inside `syncPendingOperations`
  before it reaches the network.
- `/proc/<pid>/task/<tid>/wchan` shows the JS thread (`mqt_v_js`) in `do_epoll_wait`: idle in its
  event loop, not blocked in a native call, and 0 % CPU.
- The cycle's own 35 s and 45 s deadlines never fire, which matches the premise the checkpoint
  instrument was designed around: `sync-cycle-checkpoint.constants.ts` records that every JS timer
  bound is dead in the background task.

`sync_runtime_status.last_cycle_stage` cannot narrow this further: only three patch builders write
it, so `reconcile` and `result_bookkeeping` are unreachable values and both report `null`.
`HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE` documents this and names the follow-up this feature closes:
"splitting them further requires `reconcile.helpers.ts` to publish its own checkpoints".

## Goal

One hung cycle leaves a `sync_cycle_checkpoint` row naming the exact stage it entered last, written
synchronously to `autoreas-telemetry.db` with a native `busy_timeout` bound, so the stage is
readable after the fact regardless of the jam.

## Non-goals

- No change to sync behaviour, ordering, or the wire payload.
- No new stage vocabulary: only the existing closed set `SYNC_CYCLE_STAGES`.
- No fix for the hang itself. The instrument comes first so the fix has a red test.
- No change to `sync_runtime_status`, its writers, or its schema.

## Tasks

### T1 — Publish fine-grained checkpoints from the reconcile pass

- Surfaces: `src/features/sync/reconcile.types.ts`, `src/features/sync/reconcile.helpers.ts`
- Add an optional checkpoint recorder to `syncPendingOperations`, of the closed
  `SyncCycleStage` type, synchronous and never throwing.
- Record on ENTRY of each step, never on completion: `backlog_read` before the backlog read,
  `claim_ops` before the claim write, `http` before `bridgeClient.reconcile`, `parse_response`
  once the response is in hand and before the schema parse, `apply_write` before the
  `applyReconcileResponseWrites` write.
- Red: `tests/features/sync/reconcile-checkpoint-wiring.test.ts` asserts the exact ordered
  sequence for one successful pass, and that a throw inside the HTTP step leaves the last
  recorded stage at `http`.
- Evidence to record: test name + pass output.

### T2 — Wire the checkpoint store into the headless cycle

- Surfaces: `src/features/sync/headless-sync-cycle.helpers.ts`
- Mint the cycle id before the first await so the instrument covers `open` and `bridge_config`
  too, create the store with `startedAt` = the cycle's start, and record the exact
  correspondences: `open`, `config`, `attempt_started`, `cycle_activated`, `prune`, `closed`.
  Do not invent a label for `reconcile`/`result_bookkeeping`: the reconcile pass publishes those.
- Pass the recorder into `syncPendingOperations`.
- Red: `tests/features/sync/headless-sync-cycle-checkpoint.test.ts` asserts a healthy cycle's last
  recorded stage is `closed`, and that a cycle throwing inside the reconcile pass leaves the last
  recorded stage inside the reconcile vocabulary rather than `attempt_started`.
- Evidence to record: test name + pass output.

### T3 — Validate on the device that the instrument answers the question

- Reproduce with the deterministic harness, then read
  `files/SQLite/autoreas-telemetry.db` → `sync_cycle_checkpoint`.
- Pass condition: the row names the stage the hung cycle entered last, and it discriminates a
  local write-door jam from a transport stall.
- Evidence to record: the checkpoint row, the stage, `failed_checkpoint_count`, and the harness
  command with its timestamps.

## Work units

One commit per task, Conventional Commits, tests and docs alongside the behaviour. Commits are
prepared and held until the maintainer confirms, per `AGENTS.md`.

## Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | pending | |
| T2 | pending | |
| T3 | pending | |

## Checks

- Focused: `npx jest <focused paths> --maxWorkers=4`
- Gate: `npx lefthook run pre-commit` (must not be bypassed)
- Types: `npx tsc --noEmit`
