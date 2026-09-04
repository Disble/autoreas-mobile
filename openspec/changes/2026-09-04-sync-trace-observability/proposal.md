# Proposal: Sync Trace Observability

## Intent

The phone keeps nothing per sync attempt. `sync_runtime_status` holds one clobbered row of last-known state, and Settings shows a single `last_failure_message`. So when a cycle fails while the device is locked, the only surviving artifact is a string with no sequence, no timing, and no way to tell which build produced it.

The bridge, by contrast, keeps a full request timeline with headers preserved verbatim. Every diagnosis so far has therefore been one-sided: the bridge can see what arrived, and nobody can see why something did not.

**Under the no-device constraint this stops being a convenience and becomes the only evidence channel that exists.** There is no `adb`, no `logcat`, no `dumpsys`. H06h, H04 and H16 cannot be falsified from this session at all. What *can* be done is ship the instrument inside the APK so the device records its own behaviour while the user goes about their day, and the next session reads a trace instead of arguing from source. That inverts the project's failure mode: three prior designs guessed because measurement was expensive, and this makes measurement the cheap default.

## Scope

### In Scope

- A new `src/features/sync/sync-trace/` feature (scaffolded with `npm run generate:feature`): an append-only event log with a bounded ring buffer, written to **its own file**, never through the shared write door.
- **Three clocks per event** — `wall` (`Date.now()`), `elapsedRealtime`, `uptimeMillis`. Their divergence is the only device-free way to detect that the CPU was suspended between two events, which is exactly what a locked phone does and what no single clock can show.
- **Two new native functions** on the existing `foreground-sync-ticker` module — `getElapsedRealtime()` and `getUptimeMillis()`. Verified necessary: the module currently exposes only `start`/`stop`/`isRunning` and emits `elapsedRealtime` inside the `onTick` payload, so neither clock is readable on demand and `uptimeMillis` is not exposed at all. Without these the "three clocks" requirement cannot be met, and emitting a fabricated third field would be worse than emitting two honest ones.
- **Build identity on every event** so a trace can never be misattributed to the wrong APK. H05b was only falsifiable because the binary could be inspected; traces must not need that.
- A ULID `cycleId` per reconcile cycle, emitted as the `X-Sync-Cycle-Id` header, added by extending `BridgeRequestSpec` and `buildBridgeHeaders` **inside `src/infrastructure/api/**`** so the Bridge Boundary rule holds.
- Typed event model covering the cycle lifecycle: `cycle_started`, `request_sent`, `response_received`, `parse_ok` / `parse_failed`, `commit`, `failure`, `cycle_ended`, each with a `stage` of `parse | mapping | write | transport | scheduler`.
- Export of the trace from Settings so the user can hand it over without a cable.

### Out of Scope

- Uploading the trace to the bridge. The bridge already holds ~80 % of the timeline and custom headers survive its capture sanitizer verbatim (`TestSanitizeHeadersKeepsUnknownCustomHeadersVerbatim` pins this). Correlation by header is cheaper than ingestion and needs no bridge change.
- Changing any transport or scheduling behaviour. This change observes; it does not steer.
- The durable `202` transaction (MB-0c) and the policy/status split (MB-2a).

## Capabilities

### New Capabilities
- `sync-observability`: every sync attempt is traceable end to end, carries three clocks and a build identity, and joins to exactly one bridge capture by `X-Sync-Cycle-Id`.

## Approach

Write-path isolation is the load-bearing decision. The trace must not share the file-keyed write door, because the door is one of the things under investigation — an instrument that stalls when the subject stalls records nothing about the stall. A separate file with its own append path keeps the trace alive precisely when the main path is stuck, which is the only condition anyone cares about.

The three clocks are not redundancy. `Date.now()` moves with wall time and can jump; `elapsedRealtime` advances during deep sleep; `uptimeMillis` does not. The gap between the last two across two events *is* the CPU suspension, measured rather than inferred. This is the single most valuable field in the whole subsystem for a locked-device investigation, and it costs two native reads.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/sync-trace/` | New | `index.ts`, `sync-trace.helpers.ts`, `sync-trace.types.ts`, `sync-trace.constants.ts` — event model, ring buffer, append path |
| `src/infrastructure/api/bridge-client/bridge-client.types.ts` | Modified | `correlationId` on `BridgeRequestSpec` |
| `src/infrastructure/api/bridge-client/bridge-url.helpers.ts` | Modified | `buildBridgeHeaders` emits `X-Sync-Cycle-Id` |
| `src/features/sync/reconcile.helpers.ts` | Modified | Emit cycle events; thread the `cycleId` |
| `src/features/settings/` | Modified | Trace export affordance |
| `tests/features/sync/__tests__/sync-trace.*` | New | Ring buffer, clock capture, event ordering, export |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **The trace shares the write door and dies with it** | High if unguarded | Separate file and append path; a test asserts the trace still records while the shared door is blocked |
| Trace I/O costs battery on a constrained device | Low | Bounded ring buffer, one batched append per cycle, separate file |
| `elapsedRealtime` / `uptimeMillis` are unavailable in JS without a native call | **CONFIRMED — this is now scope, not a risk** | Verified in `modules/foreground-sync-ticker/android/.../ForegroundSyncTickerModule.kt`: the module exposes only `Name("ForegroundSyncTicker")`, `Events("onTick")` and `Function("start"/"stop"/"isRunning")` (`:99-111`). `SystemClock.elapsedRealtime()` appears **only inside the `onTick` event payload** (`:45`), reachable only while the ticker is running, and `uptimeMillis` is not exposed at all — it appears solely in a comment (`:22-24`). So the three-clock model requires **adding two native functions** to that module, `getElapsedRealtime()` and `getUptimeMillis()`. Small (two one-line `Function` blocks) but it is a native change and therefore needs an APK rebuild to take effect. Bring it into scope explicitly rather than discovering it at apply time |
| A trace is read against the wrong build | Medium | Build identity on every event, non-optional |
| Events accumulate unbounded | Medium | Ring buffer with an explicit cap; a test proves the oldest event is evicted |
| Staged files inherit `dharness` JSDoc debt | High | JSDoc written as part of each file (constraint 12) |

## Rollback Plan

Revert the commit. The feature is additive: a new folder, one optional request field, one header, and emit calls. The trace file is left in place; nothing reads it after revert.

## Dependencies

MB-0a should land first so that traced cycles are already bounded — otherwise the trace's most interesting case (a cycle that never ends) is also the case where the trace never gets its terminal event. Not a hard block: the subsystem is independently testable.

## Success Criteria

- [ ] Every reconcile cycle emits a `cycle_started` and exactly one terminal event.
- [ ] Every event carries all three clocks and a build identity.
- [ ] The trace records normally while the shared write door is blocked — asserted by test, not by inspection.
- [ ] `X-Sync-Cycle-Id` is present on every bridge request and is added inside `src/infrastructure/api/**` only.
- [ ] The ring buffer evicts oldest-first at its cap.
- [ ] The trace is exportable from Settings.
- [ ] Regression floor holds: 109 suites / 654 tests, plus the core behaviour suite, stay green.
