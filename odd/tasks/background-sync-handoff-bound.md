# background-sync-handoff-bound

> **Superseded 2026-09-19 by `odd/tasks/background-sync-native-bound.md`.** T3 (patch
> `expo-background-task`) and T6 (force source compilation) are retracted: both modify a dependency,
> and its Android code is consumed as a prebuilt AAR anyway, so the patch is inert. T2, T4 and T5 are
> carried over to the successor feature. This file is kept as the record of how the patch path was
> chosen and why it failed.

Feature: make the Android background-task hand-off bounded, and settle the two unvalidated links in
the investigation log that the fix depends on.

## Why

`docs/mobile-background-sync-investigation-log.md`, section "Audit", established that the stated
mechanism rests on exactly two links and that **both are unvalidated**:

1. **The JS task never acknowledges completion.** Inferred from "the worker does not return", which
   is itself inferred from the 600 s JobScheduler timeout. Nobody observed the acknowledgement path.
2. **The cycle's own bounds do not fire.** Inferred from `is_cycle_active` staying 1. The
   alternative explanation is that the bound *did* fire and its recovery writes failed through the
   jammed door — the failure mode `recordAbandonedCycle`'s own documentation anticipates.

Everything else in that section is measured. The audit also recorded one upstream fact that changes
the fix shape: **`expo-background-task` awaits `tasks.awaitAll()` with no timeout, and its `catch`
leaves a `CompletableDeferred` permanently uncompleted** (expo/expo#49422, closed without a fix,
with a suggested two-part fix). A hand-off that is never acknowledged therefore holds the job for
JobScheduler's entire 10-minute budget instead of failing bounded.

## Goal

A background job whose task is not acknowledged ends as a **bounded** failure, and the log records
which link was true — so the next step is chosen from evidence instead of from an inference.

## Non-goals

- Not fixing the sync itself. Bounding the hand-off does not make sync work; it makes the failure
  observable and cheap, and it stops the 100 % duty cycle that exhausts the Android 15 `dataSync`
  budget and stops the FGS from being startable.
- No change to `sync_runtime_status`, its writers, or its schema.
- No change to the sync wire payload or stage vocabulary.
- No battery-optimisation exemption, and no Doze whitelist: both are refuted in the log.

## Cost and order — the reason the tasks are sequenced this way

The repo has **no `android/` project** (the native project is generated at prebuild and built through
EAS) and **no patch mechanism** (`patches/`, `patchedDependencies`, `patch-package` are all absent).
So a Kotlin change to `expo-background-task` **requires a native rebuild and reinstall**, while the
two diagnostic tasks below are free: one is a logcat filter on the installed build, the other is
JS-only and reloads through Metro.

The free, load-bearing measurement therefore comes **first**, and the fix comes after it.

## Tasks

### T1 — Correct the stale comment
- Surface: `src/infrastructure/db/sync-cycle-checkpoint/sync-cycle-checkpoint.constants.ts`
- The comment claims "every JS timer bound is dead in the background task (the `HeadlessJsTask` that
  keeps `setTimeout` alive is never registered)". The installed `expo-task-manager` carries expo PR
  #43821, which registers with `HeadlessJsTaskContext` so JS timers keep firing. The justification
  the comment gives for the checkpoint's design survives; the premise it states does not.
- Rewrite it to the mechanism that is actually true — timers are kept alive *by* that registration,
  and the checkpoint still does not depend on them because it must also survive a jammed write queue
  and a blocked JS thread.
- Evidence: the comment text before and after; no behaviour change, so the existing tests must stay
  green.

### T2 — Confirm expo PR #43821 actually activates on this device

- Free: no rebuild, no code change.
- The code being present is not the same as the code running. Everything downstream depends on
  whether `HeadlessJsTaskContext.isRunningTasks` becomes true during a background task.
- ~~Logcat filter for the task-service log lines.~~ **BLOCKED — the logcat instrument does not
  deliver.** Result of the attempt: the buffer covers 13:30:21 → 18:47:28 and holds 86 lines from
  this app, including `BackgroundTaskScheduler` (47), `BackgroundTaskWork` (15),
  `BackgroundTaskConsumer` (4) and `ExpoModulesCore` — so Expo's native logging works for this app —
  yet **not one line carries the `TaskService` tag**, which is the tag `TaskService.java` uses
  (`private static final String TAG = "TaskService"`, line 58). The control line
  (`internalRegisterTask`, line 475, `Registered task with name ...`) should also have appeared and
  did not, and the restore path may reach a consumer without passing through it, so **no line could
  be shown to be one that must appear**. Without that control, an absent line proves nothing.
- **Replacement method, and it is cheaper and decisive: stop observing the registration and measure
  its effect.** The synchronously-written checkpoint is the instrument. Add a checkpoint at the top
  of `recordAbandonedCycle` (see T5): it runs only if the cycle's own 35 s `withDeadline` fired. A
  row appearing there proves JS timers are live during the background task; its absence, on a cycle
  that then hangs for 600 s, proves they are not. Either answer settles link 2, which is the
  load-bearing one, and it is JS-only (Metro reload, no rebuild, no logcat).
- Evidence: the tag inventory above (the negative result and *why* it is negative), plus the
  replacement probe's reading.

### T3 — Bound the hand-off in `expo-background-task`

- Surfaces: `patches/expo-background-task@<version>.patch` (new), `package.json`, `bun.lock`
- Mechanism: bun's `patchedDependencies`, which is this repo's idiom for a dependency change
  (it uses bun, and it has no install-time scripts — `postinstall` and `prepare` are both absent and
  must stay that way).
- Change, per expo/expo#49422's suggested fix:
  1. Complete (or fail) `taskCompletion` in the `catch` branch, so a throw cannot leave a
     permanently pending deferred in the awaited list.
  2. Wrap `tasks.awaitAll()` in `withTimeout(...)` and surface the timeout as a bounded result so
     WorkManager can reschedule normally.
- The timeout must sit **well below JobScheduler's 600 s** and **above the cycle's own worst case**:
  `HEADLESS_SYNC_CYCLE_DEADLINE_MS` (35 s) plus `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` (45 s) plus the
  8 s recovery budget. 90 s gives ~2× headroom over the outer bound.
- Evidence: the patch file, `bun install` clean, and the generated `patchedDependencies` entry.
- **Reopened 2026-09-19: the patch never reaches the binary.** `expo-background-task` ships a
  prebuilt AAR (`expo-module.config.json` → `android.publication`, repository `local-maven-repo`) and
  autolinking consumes the publication instead of the source project (`ExpoAutolinkingPlugin.kt`
  partitions on `usePublication`; the build log prints `[📦] expo-background-task (55.0.20)` on that
  branch). `patchedDependencies` edits `.kt` files Gradle never compiles. Owner: T6.

### T6 — Make the patch actually reach the binary, and verify the artifact

- Surfaces: `package.json` (`expo.autolinking.android.buildFromSource`), `docker-compose.eas.yml`
  (replace the source proxy with an artifact check)
- Two changes, both required:
  1. Force `expo-background-task` to build from source, so the patched Kotlin from T3 is what the
     compiler sees. Supported knob: a regex list matched against the Gradle project name.
  2. Replace the guard. Grepping `withTimeout` in the patched source proves nothing (it passed on
     every unpatched APK) and reads `/app/node_modules`, a tree EAS never compiles. The check must
     read the produced artifact: unzip `classes*.dex` from the APK and require the patch string,
     with a control string that exists in both versions, or fail the build.
- Evidence: `- [📦]` must disappear for this module in the Gradle log, the dex check must report the
  patch string present, and the control must still be present.

### T4 — Run the decisive experiment and record the verdict on link 1

- Requires the native rebuild from T3 to be installed.
- Reproduce: app genuinely closed, then observe the next natural run (the forced job is not a
  deterministic harness — see the log's refuted list).
- Pass condition for link 1: the job ends in **~90 s as a bounded failure** instead of 600 s, and
  the log shows the hand-off timeout. Fail condition: it still hangs for 600 s, which means the
  acknowledgement is not the problem and link 2 becomes the leading explanation.
- Record the verdict in the log either way, including the counter-case.
- Evidence: `dumpsys jobscheduler` historical stats before/after, the log line, and the timings.

### T5 — Instrument the gap between `backlog_read` and `http`, and the abandonment path

- Surfaces: `src/features/sync/sync-diagnostics-flush.helpers.ts`, `src/features/sync/reconcile.helpers.ts`,
  `src/features/sync/headless-sync-cycle.helpers.ts`
- Two probes, both reusing the checkpoint store that is already wired:

  1. **The abandonment probe (from T2's replacement method).** Record a checkpoint at the top of
     `recordAbandonedCycle`. That function runs only when the cycle's own 35 s `withDeadline` has
     fired. A row there proves JS timers are live in the background task; its absence on a cycle
     that then hangs 600 s proves they are not. That is link 2, decided by one background run.
  2. **The gap checkpoints.** The audit's "never tried" item 1: this is the only un-instrumented
     stretch on the path the cycle actually dies on, and it is what T3 of the previous feature was
     supposed to resolve and did not. In that gap sit `flushSyncDiagnosticsOutbox` (the only network
     call), `readAnimeBridgeTokens`, `buildReconcileRequestBody`, and `getLastChangelogId`.

- `SYNC_CYCLE_STAGES` has no member for those steps, so either extend that closed set deliberately
  or reuse the nearest existing member with the choice written down — do not invent a label
  silently.
- Note the interaction: the two probes answer different questions and neither depends on the other.
  If the abandonment probe fires, the cycle's bounds work and the gap is where the cycle is stuck;
  if it does not, the bounds are inert and the gap is a consequence, not the cause.
- Evidence: the new stages appearing in `sync_cycle_checkpoint` on the next background run, with the
  cycle id and elapsed offsets.

## Acceptance

The feature is done when T2 and T4 have both produced a recorded verdict on the link they test, and
T5 has produced a stage name for the hang. The full acceptance metrics for a *sync* fix live in the
investigation log; this feature is not expected to move them.

## Work units

One commit per task, Conventional Commits, tests and docs alongside the behaviour. Commits are
prepared and held until the maintainer confirms, per `AGENTS.md`.

## Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | done | Comment rewritten to the true mechanism. `npx eslint <file>` clean, `npx tsc --noEmit` clean, the 7 instrument tests still pass. |
| T2 | **blocked — instrument failed** | Logcat cannot serve: no `TaskService` tag for this app, and no line could be shown to be one that must appear. Replacement method folded into T5. |
| T3 | **insufficient — reopened as T6** | The patch applies to the tree and never to the binary: the module is consumed as a prebuilt AAR (see T6). |`patches/expo-background-task@55.0.20.patch` (new) + `patchedDependencies` entry in `package.json` + `bun.lock` update. Acceptance is the container's own first command, not a proxy: `bun install --frozen-lockfile` succeeds (`Checked 1425 installs across 1332 packages (no changes)`), and the change survives `rm -rf node_modules/expo-background-task` + reinstall. On disk at `BackgroundTaskScheduler.kt`: imports 21/25, constant 60, `withTimeout` 272, catch 275, `taskCompletion.complete(Unit)` at 265. `npx tsc --noEmit` clean; `npx jest tests/features/sync --maxWorkers=4` 74 suites / 581 tests green. No `postinstall` or `prepare` added. | |
| T4 | pending | |
| T5 | pending | |
| T6 | pending | |

## Checks

- Focused: `npx jest <focused paths> --maxWorkers=4`
- Gate: `npx lefthook run pre-commit` **with the files staged** (unstaged it reports every hook as
  skipped, which looks green and measures nothing)
- Types: `npx tsc --noEmit`
- Native: the T3 change needs a rebuild before T4 can observe anything
