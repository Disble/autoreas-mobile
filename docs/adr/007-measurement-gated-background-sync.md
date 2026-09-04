# ADR 007: Measurement-Gated, Outbox-First Background Sync

## Status
**Partially Accepted (2026-09-04).** Four independent review lenses reported and 52 findings were applied (`docs/mobile-bridge-background-sync-redesign.md` §15). The §8.6 half of the declared review gap is now closed by Appendix C, which grounded the WebSocket decision in three source-verified defects instead of general argument. §11 is settled in practice: `team-bridge` implemented B6/B4/B3 on `test/bridge-sync-contract-fixes` with the repo gate green.

**What changed the status.** Device access was withdrawn for the execution run, so H03, H04, H06h, H09 and H16 cannot receive `(device)` verdicts at all — the gate this ADR was written around is unobtainable rather than merely pending. The response is to split the decision rather than stall it:

- **Accepted now:** decisions 1, 3, 4, 5 and 6, plus every part of decision 2 that repairs a source-verified defect. These stand on evidence that exists.
- **Still Proposed:** the engine substitution in decision 2 — the one-time WorkManager flush and the budgeted foreground-service session. Both remain contingent on measurements nobody can take yet, and building them blind is the exact failure this ADR exists to prevent.

One hypothesis did reach a verdict without a device. **H05b is FALSIFIED** from the shipped binary: `build-1786545901341.apk` (2026-08-12) carries `ForegroundSyncTicker` 16 times in `classes*.dex` and in its Hermes string table. The July 2026 ticker fix shipped, is installed, and sync still fails while locked — which removes the cheapest explanation and leaves only mechanisms.

Full Accepted status requires device verdicts for the contingent half. The path to them is now the product itself: the trace subsystem ships inside the APK, so the device fills in `(device)` by being used, rather than a session assuming on its behalf. See `docs/sdd-plan-background-sync-redesign.md` §10.

## Context
Sync between the mobile app and `autoreas-bridge` degrades to multi-hour delays when the phone is locked. Three designs (2026-04-10 ×2, 2026-07-16) each chose a keep-alive mechanism — periodic WorkManager, a `dataSync` foreground service, then a native wake-locked ticker — without measuring on a device which mechanism was actually delivering. Bridge-side captures now show that the 15-second native tick is not what reaches the bridge in the background, that an exact 600-second scheduler is, that reconciles the bridge accepts leave no durable trace on the phone, and that the "15-minute WorkManager floor" every design relied on runs every 15 hours because of a unit mismatch. Whether the phone receives those responses and fails to persist them, or never receives them at all, is not yet distinguished — the captures record the bridge's write, not the phone's read — and the design treats it as an open question rather than a settled one. A source-level reading of `expo-background-task` since supplies a candidate mechanism that would produce both readings at once, by killing the job mid-cycle at a host runtime limit. On the target SDK (35), a `dataSync` foreground service is capped at 6 hours per 24 by the OS.

The full evidence, hypotheses and measurement protocol live in `docs/mobile-bridge-background-sync-redesign.md`.

## Decision
1. **No background keep-alive mechanism is selected by preference.** Each candidate is a falsifiable hypothesis with a discriminating device test. Architectural decisions that depend on a hypothesis are marked contingent and are not implemented until the hypothesis has a verdict.
2. **The background obligation is outbox delivery with bounded latency and a durable local footprint for every accepted reconcile** — not continuous polling. Inbound freshness is a foreground obligation. A one-time, network-constrained WorkManager request is the default delivery engine; the foreground service becomes a budgeted, explicitly stopped session started only from the foreground.
3. **Policy is separated from mechanism.** A `SyncPolicy` yields a `SyncDecision` value with blocker reasons; engines only execute. User-visible status is derived from trace and OS queries, never from closure booleans.
4. **Observability is a precondition.** An append-only trace with three clocks (`wall`, `elapsedRealtime`, `uptimeMillis`), a ULID cycle id sent as `X-Sync-Cycle-Id`, and the build identifier is built before any transport change, and correlated with the bridge's existing `request_captures`.
5. **The Android lab mirrors `tests/sqlite-lab`**: named hypotheses, `CONFIRMED | FALSIFIED | NOT_FALSIFIABLE` verdicts, a mandatory environment record, and the rule that a falsified hypothesis is a result.
6. **Bridge contract changes are proposed, not assumed**: WS keepalive, dedupe by device with close code `4001 superseded`, cursor semantics after prune, `applied_operations` documentation, token redaction in captures.

## Consequences
### Positive
- Failures become attributable to a phase (`parse | mapping | write | transport | scheduler`) and to a build.
- Battery cost becomes proportional to work: no wake lock while idle.
- The design is robust to either outcome of the Doze/FGS measurements, with a documented escalation path (battery exemption before FGS type change).
- Bridge and mobile share one timeline through a single header.

### Negative
- Nothing user-visible improves until Phase 0 and Phase 1 complete; the design deliberately defers the transport fix.
- A small local Expo module is required for the one-time outbox flush: `expo-background-task` already runs a self-rescheduling one-time WorkManager chain on Android 8+, but its scheduler is private and interval-only, so a flush cannot be requested from outside it. The module implements `TaskConsumerInterface` and reuses `expo-task-manager`'s headless executor rather than inventing a second Worker→JS path.
- Two teams must move in step on the WebSocket contract.

## Superseded assumptions
- "WorkManager provides a 15-minute best-effort floor" (2026-04-10) — it provided 15 hours.
- "Notifee's foreground callback is not a headless task, so JS timers freeze" (2026-07-16) — `react-native-notify-kit ^10.5.0` registers it with `AppRegistry.registerHeadlessTask`.
- "A `dataSync` foreground service can run indefinitely" — capped at 6 h/24 h on targetSdk 35.
