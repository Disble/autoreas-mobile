# Mobile → Bridge Diagnostic Telemetry

Status: current as of convergent-sync T18 (2026-10-17). Contract agreed with `autoreas-bridge` against its source, not its documentation.

## What reaches the bridge today

Two channels, and nothing else:

| Channel | Producer | Endpoint | Content |
|---|---|---|---|
| Cycle envelope | the native engine (`ReconcileRequestBody.kt`) | `POST /api/sync/reconcile`, first request of a cycle | `client_telemetry: { cycle_id, trigger_source, counters: { pending_ops_count } }` |
| Chapter-action observations | `chapter-action-diagnostics.helpers.ts` (`kind: "episode_action"`) | `POST /api/sync/diagnostics`, through the durable diagnostics outbox | one observation per chapter action phase |

The JS reconcile body never carries a `client_telemetry` key. The bridge requires nothing in that envelope beyond `counters`, so its absence is not a wire failure.

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
