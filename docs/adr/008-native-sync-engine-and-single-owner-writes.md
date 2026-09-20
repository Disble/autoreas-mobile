# ADR 008: Native Sync Engine and Single-Owner Writes

## Status

**Accepted 2026-09-20.** The four decisions below were taken by the maintainer, and the evidence that forced them is device-measured rather than inferred. Implementation is tracked as ODD feature `mobile-sync-native-engine` (`odd/tasks/mobile-sync-native-engine.md`), sliced S1..S6.

**Amends ADR 007** rather than superseding it. What 007 got right is kept: no keep-alive mechanism is selected by preference (decision 1), the background obligation is outbox delivery with bounded latency rather than continuous polling (decision 2), policy is separated from mechanism (decision 3), observability is a precondition (decision 4) and bridge contract changes are proposed, not assumed (decision 6). What changes is the substrate those decisions run on, and one ownership mechanism.

**What changed since 007 was written.** 007 was gated on device measurements it could not take — device access was withdrawn for its execution run, so `H03`, `H04`, `H06h`, `H09` and `H16` never received `(device)` verdicts and its contingent half stayed `Proposed`. Those measurements now exist (2026-09-19 and 2026-09-20), and they contradict part of the reasoning in `docs/mobile-bridge-background-sync-redesign.md`:

- The six-hour `dataSync` cap is no longer the mechanism. The service declares `specialUse` at targetSdk 35 and survived 8 h 43 m with the app closed, with no `Service.onTimeout`.
- The write queue is **not** stranded "for the remainder of the process", as that document's Appendix E asserted: `sync_runtime_status.last_cycle_id` advances with a current `last_cycle_stage_at`, and `consecutive_unclosed_cycles` climbed from 34 to 41 within an hour. Each attempt lands its early writes and then parks; the jam is per attempt.
- What Appendix E got right and this ADR adopts: **every bound on the cycle path is a JS timer**, and the failure left a cycle lease expired, an `is_cycle_active` flag stuck at 1, two operations stranded in `processing`, and the app in Android's `RESTRICTED` stand-by bucket.

---

## Context

The mobile sync cycle parks inside a local write and never returns. 41 consecutive attempts ended as `never_closed`, each terminated by the platform at ~600 s, because no bound inside the app fired. The architecture that produced this has five structural defects, named and evidenced in `docs/mobile-sync-architecture.md` §4: a file-wide mutex shared by every lifecycle; a mutex with no ownership contract, lease, reentrancy guard or bypass; a failure path that re-enters the resource that failed; a cycle lease routed through the door it is supposed to protect; and liveness that depends on a timer inside the runtime being guarded.

Adding timeouts to that shape does not make it correct; it makes it fail faster.

---

## Decision

1. **The background sync engine is native (Kotlin).** It owns transport, claim, staging, cursor, prune and the journal. No JS timer remains on the background sync path, so the paused-timer failure class leaves with it, together with `expo-background-task` and the JS-only bounds. The port is bounded and that is what makes the decision viable: in `staged` mode the background cycle never writes `animes` — only the foreground drain hook does — so the domain apply logic stays in TypeScript, where the foreground already owns it.
2. **No resident foreground service by default.** The bridge's availability window is a user profile, not a constant of the system: some bridges are up all day, some are up one hour. The requirement is a property — cheap while the bridge is absent, reliable when it returns, without knowing the schedule in advance — so delivery becomes a policy choice. An always-on path (a resident session, or push if the bridge ever pushes) is an opt-in capability for profiles that need near-real-time, not the default. The service was originally held to keep JS timers alive in the background; decision 1 removes that reason.
3. **Writes have a single owner per store, with lease and fencing.** The process-wide, file-keyed write door stops being the app's global arbiter and is replaced by one writer per store whose ownership is recorded, expires, and can be reclaimed by a contender. The sync-critical state is separated from the UI's store so that a parked write on one side cannot delay the other. The `local-write-serialization` contract is deliberately broken by this decision: it serialized writes correctly and made the whole app share one fate.
4. **Liveness is a native watchdog plus journal recovery, and the `HeadlessJsTask` registration remedy is retired.** The guarantee moves outside the guarded work: a native watchdog can abandon an attempt and record it, with the OS's own stop of an over-long job as the outer backstop. Since decision 1 leaves no JS timer on the sync path, restoring the registration would keep alive something the design no longer depends on; it is retired by decision, not rejected as wrong. Recovery from durable state is the safety net for the case where even the abandon record cannot be written, which is why the journal must land before the watchdog.

---

## Consequences

**Positive.** A parked attempt becomes a bounded, observable event instead of a ten-minute silence; the app stops burning job quota and leaves Android's `RESTRICTED` bucket; a no-op attempt costs milliseconds, so the periodic cadence becomes cheap for any availability profile; the guarantee no longer depends on the runtime it guards.

**Costs and risks, stated plainly.**

- The largest single piece of work in the project's sync history: a background engine in Kotlin. It is bounded (transport and staging, not the domain), but it is a rewrite of the runner, not a patch.
- Two implementations exist during the migration — the JS cycle and the native engine — and two implementations of one contract drift. The wire mapping must be diffed against the TypeScript schema and mapper on the captured bodies before the JS path is retired.
- Breaking `local-write-serialization` means the ownership model itself must be correct: an actor that cannot be killed, or a lease that cannot be reclaimed, recreates the same class of permanence with a new name.
- Moving a boundary this far from the project's feature-sliced TypeScript conventions requires the native module to state its contract explicitly, as this ADR does, or the architecture rules of `AGENTS.md` lose their meaning by exception.
- The native engine cannot be observed without a device rebuild, so the slices S1–S2 are deliberately chosen to be useful before the engine lands.

**Invariants this ADR puts in force.**

1. No attempt ends without a terminal journal state: `closed`, `failed` or `abandoned`.
2. No attempt state is known only to an in-memory promise: a state older than its lease is recoverable by any subsequent attempt.
3. No failure is reported through the resource that failed.
4. No availability schedule is assumed by the design.

---

## References

- `docs/mobile-sync-architecture.md` — the proposal, the five defects, the target architecture and the S1..S6 migration this ADR authorizes.
- `docs/mobile-background-sync-investigation-log.md` — the measurements, with their instruments.
- `docs/adr/007-measurement-gated-background-sync.md` — the decisions kept and the gate this ADR closes.
- `docs/mobile-bridge-background-sync-redesign.md` — the design that produced the hypotheses, including the ones the device refuted.
- `odd/tasks/mobile-sync-native-engine.md` — the implementation backlog.
