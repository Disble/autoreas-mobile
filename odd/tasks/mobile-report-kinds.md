# Mobile report kinds

Objective: give the tablet a durable diary of its sync behaviour so a silence can be explained after the fact. Native failed cycles send `cycle_report`, each closed hour sends `hourly_summary`, and real state changes send `runtime_transition`, through the existing diagnostics outbox.
Branch: `feat/mobile-report-kinds`, cut from `main` at 77f0737 (2.7.1). Bridge counterpart: autoreas-bridge branch `feat/mobile-report-kinds` (head 0d747f72, not released; contract in its `docs/openapi.yaml`). Delivery: local merge. Runners: Jest (`tests/`) and Kotlin unit tests.

## Specs

- **S1 — Failed cycles name where they failed.** Today `transition("failed")` runs before `outcome("failed", lastState, ...)` (`SyncEngineCycle.kt:137-138`, also the `fail()` path), so the stage is always `failed`. The outcome must carry the state the cycle was in before it failed.
- **S2 — `cycle_report` for native failed cycles only.** Agreed with Bridge (autoreas-bridge-78, 2026-11-06):
  - The failure goes inside `previous_cycle` with `outcome: "failed"` and the failed cycle's own id; top-level `cycle_id` may equal it and must never be empty (Bridge answers 400 `field_rejected` naming `cycle_id`).
  - Required keys: `degraded` (nullable), `trigger_source` (`foreground_service` or `background_task`), `app_state` (`background`), `previous_cycle`, `counters` (send `pending_ops_count` and `cursor`); send `recent_events: []`.
  - Stage map: `checked` → `attempt_started`, `claimed` → `claim_ops`, `sent` → `http`, `applied` → `apply_write`. `native_fgs_tick` → `foreground_service`.
  - `error_name` maps to Bridge's closed list with fallback `unknown`; `error.message` is never sent.
  - `abandoned` and `not_applicable` cycles are not reported. Limited per cause per hour.
- **S3 — `hourly_summary`, one body per closed hour.** Contract served by Bridge (autoreas-bridge-de, 2026-11-07):
  - `observation_id` = install id + hour; required `hour_start_ms`; first write per `observation_id` wins.
  - `counts[]` of `{trigger_source, outcome, count, max_duration_ms?}`, at most 64, each pair once, `count` 0-100000, `max_duration_ms` 0-3600000.
  - `trigger_source` exactly: `foreground_service`, `background_task`, `bootstrap`, `manual`, `app_active`, `network_regained`, `local_mutation`, `ws_sync_required`.
  - `outcome`: `closed`, `failed`, `presence_refused`, `schema_not_ready`, `skipped_owned_by_ticker`, `unsettled`, `crashed`.
  - Top-level `dropped_count` 0-100000. Optional `process_deaths[]` of `{process_name main|sync, reason, count}`, at most 16, each pair once, counted in the hour they are read.
  - Counts every attempt of both engines, foreground included, so an empty hour means nothing ran.
- **S4 — `runtime_transition`, real state changes only, never per tick.** Fields `observation_id`, `observed_at_ms`, `process_name` (`main`, `sync`), `subject`, `transition`, optional `reason` (`^[a-z0-9_]{1,40}$`), `app_version` (`^[0-9A-Za-z._+-]{1,32}$`). Only these 14 pairs:
  - `service`: `started`, `stopped`, `refused`
  - `tick_alarm`: `armed`, `cancelled`
  - `floor`: `armed`, `cancelled`, `skipped` (only when it changes from running to skipped), `started` (runs again after skipping)
  - `process`: `started`, `died` (`died` only with `process_name: sync`; `observed_at_ms` is Android's exit timestamp)
  - `boot`: `started` (`observed_at_ms` is the computed boot time)
  - `network`: `started`, `stopped`
- **S5 — Volume and outbox rules.** Owner approval (2026-11-07, relayed by autoreas-bridge-de): "the limit of at most 50 new reports a day across the new kinds is approved". New-kind rows stop at 60 of the outbox's 100 rows, keeping 40 for `episode_action`; skipped rows are counted in `dropped_count`. Delivery: reconcile first, one request in flight; only `kind_not_served` keeps rows; `field_rejected`, `kind_malformed`, `body_too_large` are not retried. One event per POST, at most 8 KiB.
- **S6 — No new timer on the tablet.** Closing an hour rides existing sync cycles and events (owner prefers events over loops).
- **S7 — Out of scope.** Host or remote address capture ("Host or remote address capture is still undecided"). Fixing the floor gate and the return after reboot waits for evidence from this diary.
- **S8 — Frozen-controls window.** The change goes in `docs/logbooks/frozen-controls.md` "Changes under observation" while the M1 window is open (ends 2026-11-17 22:45).

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1 | inline | done: RED (expected `sent`, was `failed`), GREEN; 9 tests that pinned the old stage updated (lease loss at apply now reports `applied`); mutant (record line deleted) killed, 10 failures; Kotlin 456/456, lefthook green | d28e0c8 |
| T2 | S3, S5, S6 | delegated (context backstop) | open: diary store in the ticker module, kind registries, reserve and daily limit, hourly counters and summary emission, JS attempt recording | |
| T3 | S2, S4 | delegated (context backstop) | open: native attempt counting, transitions, process deaths, boot, network, failed-cycle `cycle_report` | |
| T6 | S8 | inline | open: logbook and docs | |

## Log

- L1 (2026-11-06, user): "Sí, haz eso y también ayúdame con una respuesta a una pregunta que tengo. ¿Por qué parece que hay como 50 modos de sincronización en background? Porque parece que cuando no funciona uno, funciona otro, etc. En teoría no es malo tener respaldos. Lo que yo creo que es malo es mantener cosas que realmente no sirven."
- L2 (2026-11-06, user): "Eso me parece una solución blanda. [...] yo veo que el problema que tenemos en mobile es que cuando nosotros queremos resolver un problema, nosotros no tenemos forma de saber qué pasó."
- L3 (2026-11-07, user): "ya debiste haber empezado!" — go-ahead for the mobile side of the agreed contract.
- L4: evidence. Reports from the tablet (`cycle_report`) stopped about 2026-09-21, most likely when the tick moved to the native engine (`e038901`); inferred, not proven. No alarm noticed for about seven weeks.
- L5: design decisions (parent, after the read-only map of 2026-11-07).
  - The native diary writer lives in the `foreground-sync-ticker` module: `sync-engine` depends on it (`modules/sync-engine/android/build.gradle:98`) and the ticker cannot depend on the engine, so both reach one writer only there.
  - It writes `autoreas-telemetry.db` with `android.database.sqlite`, busy timeout 250 ms, from the main and `:sync` processes. It never creates the file: when the file is missing the report is dropped, as `SyncEngineDiagnosticsOutbox` already does. Kotlin owns the DDL of the new diary tables (`CREATE TABLE IF NOT EXISTS`).
  - JS records its attempts through a native method on the ticker's Expo module, so the counters have one writer implementation.
  - A closed hour is emitted by the next recorded attempt or transition, never by a timer (S6). The install id is a random UUID minted once in the diary state; no install id existed before.
  - Outcome mapping for counts: native `abandoned` counts as `unsettled`; `not_applicable` with no config or a lease held elsewhere is not counted.
  - Bridge contract source: autoreas-bridge `git show feat/mobile-report-kinds:docs/openapi.yaml` (schemas `SyncDiagnosticsCycleReport`, `SyncDiagnosticsHourlySummary`, `SyncDiagnosticsRuntimeTransition`); every new body names its `kind`.
  - Found, out of scope: the Kotlin accepted kinds lack `screen_stall` (`SyncEngineDiagnosticsCourier.kt:62`), so screen stalls drained natively are parked and reaped after 7 days. Follow-up, not in this feature.
