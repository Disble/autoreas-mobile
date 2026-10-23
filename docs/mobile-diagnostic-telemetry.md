# Mobile → Bridge Diagnostic Telemetry

Status: current as of convergent-sync T18 (2026-10-17). Contract agreed with `autoreas-bridge` against its source, not its documentation.

## What reaches the bridge today

Three live channels, and nothing else:

| Channel | Producer | Endpoint | Content |
|---|---|---|---|
| Cycle envelope | the native engine (`ReconcileRequestBody.kt`) | `POST /api/sync/reconcile`, first request of a cycle | `client_telemetry: { cycle_id, trigger_source, counters: { pending_ops_count } }` |
| Chapter-action observations | `chapter-action-diagnostics.helpers.ts` (`kind: "episode_action"`) | `POST /api/sync/diagnostics`, through the durable diagnostics outbox | one observation per chapter action phase |
| Screen stalls | `src/features/screen-health` (`kind: "screen_stall"`) | `POST /api/sync/diagnostics`, through the durable diagnostics outbox | one observation per probe that took 2 s or more to paint |

The JS reconcile body never carries a `client_telemetry` key. The bridge requires nothing in that envelope beyond `counters`, so its absence is not a wire failure.

## Screen stalls

`ScreenStallProbe` wraps the whole app, inside `SQLiteProvider`. It times how long the screen takes to paint a change, and it arms only on events: a touch that bubbles through it, an `AppState` change to `active`, an Android window `focus`, or a window resize. When one of those fires, it re-mounts one invisible view and waits for that view's `onLayout`. That round trip crosses the JS commit, the native mount, and the layout event coming back. That is the path that stalled on 2026-10-23, when every button looked dead for two minutes while JS, SQLite, and the push all kept working.

- A probe that settles in under 2 s sends nothing.
- A slower probe becomes one `screen_stall` body. It carries the trigger, the app state when the probe armed, the window focus, the window size against the screen size (a smaller window means split screen), and the last eight window or app transitions.
- While a probe is pending, a new event does not re-arm it, so a stall is measured from its first unanswered event.
- Going to the background discards a pending probe.
- The body carries nothing about animes.

The bridge accepts `screen_stall` from **v2.4.0**, and the kind is in `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`. An older bridge answers `kind_not_served`: the row is kept and the batch stops, so every queued diagnostic waits until the bridge is upgraded. The bridge lists each stall in the MCP phone history as `screen_stall` and opens a `mobile_failure` incident for a stall of 10 s or more. The kill switch mutes it like every other observation.

## The privacy boundary

**The bridge does not sanitize request bodies.** Headers are scrubbed and response bodies are scrubbed; request bodies are stored verbatim, persist at rest, are copied with backups, and are readable through MCP.

On Android a raw `error.message` carries the database path, SQL fragments, and bound values — and in this app the bound values are anime titles. So every textual field is a **closed vocabulary**, and anything outside it collapses to `unknown` rather than being forwarded on the chance it is harmless.

`causeFromError` (`src/features/sync/sync-telemetry.helpers.ts`) is the one place a thrown value becomes a cause symbol (`SYNC_CYCLE_ERROR_CAUSES`: `closed_resource | lock_contention | disk_full | io_error | timeout | unreachable | unknown`). The message is classified on the client and only the symbol is transmitted; a non-`Error` throw yields `null` rather than being stringified.

## The diagnostics outbox

Observations are queued in a separate database file (`autoreas-telemetry.db`), never through `withLocalWrite`, so the instrument does not share a failure domain with the write door it reports on. Each foreground cycle runs `flushSyncDiagnosticsOutbox` before its reconcile; a flush failure stops that cycle before the reconcile and never triggers the reconcile-failure revert. The native engine delivers the same outbox through `SyncEngineDiagnosticsCourier`.

Rows a build before T18 queued as kindless cycle envelopes still drain under the legacy routing rule; nothing enqueues that shape any more.

## The kill switch

The switch lives in Settings, labelled "Enviar diagnóstico a la PC", stored as `bridge_config.is_sync_telemetry_enabled`, and defaults **on**. While it is off, no observation is enqueued and the outbox flush performs no request, no read and no removal. The native cycle envelope carries only an id, a trigger name and a count, and is not gated by the switch.

Settings does not render runtime counters. What Settings shows is specified in [`mobile-sync-status-ux.md`](./mobile-sync-status-ux.md).

## Removed in convergent-sync T18

The JS cycle post-mortem (`previous_cycle`, `outcome: never_closed`, `consecutive_unclosed_cycles`, `recent_events`), the in-memory diagnostic event ring that fed it, and the `sync_runtime_status` columns only it read were removed: no caller supplied the telemetry context since the headless JS cycle was retired (T16), so none of it ever reached the wire. Whether a cycle finished is now read from the native journal — see `docs/mobile-sync-architecture.md` §9. The design of the removed pipeline stays in this file's git history.
