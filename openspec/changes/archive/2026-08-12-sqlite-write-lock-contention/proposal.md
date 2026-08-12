# Proposal: SQLite write-lock contention kills chapter mutations

## Intent

Chapter `+`/`-` buttons intermittently die with `database is locked` and stay dead until force-close, silently losing the app's primary user action. Exploration adjudicated 12 hypotheses against real SQLite (11 confirmed, 1 falsified) and isolated two independent defects: deferred read-then-write upgrades that bypass the busy handler, and a leaked write transaction on a connection the app can no longer reach.

## Scope

### In Scope

1. Capture SQLite `errcode` in mutation failure telemetry — `5` and `517` are different bugs printing byte-identical text today.
2. Fix both connection leaks so a stuck connection stays reachable and closable (H6).
3. Apply `busy_timeout`/WAL at open time; drop `withExclusiveTransactionAsync`'s implicit zero-pragma connections (H2: 0.10ms vs 5534ms).
4. Key the write serializer by database FILE and route the six bypassing write sites through it (H9 0/1000; H10 one bypasser restores 363/1000).
5. `BEGIN IMMEDIATE` acquired through the async API before any synchronous drizzle statement (H3).
6. Narrow ESLint write-door rule plus an `ARCHITECTURE.md` section, mirroring the Bridge Boundary.
7. One regression arm per slice in `tests/sqlite-lab/`, recorded as runtime-harness evidence.

### Out of Scope

- Watchdog / timeout-and-advance: H11 invalidated it (corrupts transaction state, changes error class).
- Promoting a real-SQLite Jest project into the default gate — own change, own runner risk.
- A persistence boundary covering reads or feature-level drizzle access.
- Naming the leaking production connection: needs app runtime. Item 1 is the instrument for it.

## Capabilities

### New Capabilities

- `local-write-serialization`: one write door per database file, transaction isolation, connection policy.
- `write-failure-diagnostics`: errcode-bearing local write failure telemetry.

### Modified Capabilities

- None — `openspec/specs/` is currently empty.

## Approach

Six chained slices, ordered so no slice is unsafe alone.

| # | Slice | Ordering reason |
|---|---|---|
| A | errcode telemetry | Independent; ships field data immediately |
| B | Leak fixes | Removes permanence; hard precondition for E |
| C | Open-time connection policy | Makes `busy_timeout` universal before anything waits on it |
| D | File-keyed serializer + close six bypass doors | Queue and boundary must land together (H10) |
| E | `BEGIN IMMEDIATE` via async API | Safe only after B; synchronous placement freezes JS ~5.5s |
| F | ESLint write-door rule + docs | Stops a seventh door from restoring H10 |

## Affected Areas

| Area | Impact | Change |
|---|---|---|
| `src/infrastructure/db/client/client.helpers.ts` | Modified | File-keyed queue, `BEGIN IMMEDIATE`, remove exclusive path |
| `src/infrastructure/db/startup/startup.helpers.ts` | Modified | Open-time policy |
| `src/features/sync/sqlite-sync-runtime.helpers.ts`, `.../notifee-foreground-service-adapter.helpers.ts` | Modified | Leak fixes |
| `src/features/sync/{season-rating-queue,operation-log-retention,season-sync}.helpers.ts` | Modified | Route writes through the queue |
| `src/features/animes/anime-mutation-failure.helpers.ts` | Modified | errcode capture |
| `eslint.config.mjs`, `ARCHITECTURE.md` | Modified | Write-door boundary |
| `tests/infrastructure/db/write-queue.test.ts` | Modified | Drop tests 1–2 (H11); keep test 3 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A UI tap queues behind a long sync-cycle write | Med | Serialize per transaction, never per cycle; `withExclusiveSyncCycle` stays the cycle-level lock |
| A JS serializer cannot span two JS runtimes | Med | C and E remain the SQLite-level backstop; never rely on D alone |
| Fixes verified only above the `jest-expo` mock line | High | Every slice carries a `tests/sqlite-lab/` arm |
| Chain exceeds the review budget | High | `auto-chain`; six slices, each ≤150 lines |

Forecast: ~550–700 authored lines. `400-line budget risk: High`. `Chained PRs recommended: Yes`. `Decision needed before apply: No` (auto-chain cached).

## Rollback Plan

Each slice is one revertable commit. Reverting E, then D, then C restores current behavior exactly. B and A are additive and safe to retain independently.

## Dependencies

- `npm run sqlite:lab` (existing plain-Node harness) is the runtime verification path for every slice.

## Success Criteria

- [ ] A chapter tap under measured contention succeeds instead of erroring (lab dose-response arm).
- [ ] No write reaches SQLite outside the file-keyed serializer; ESLint fails a new bypass.
- [ ] Every write-capable connection carries `busy_timeout` at open time.
- [ ] A failed close leaves the connection reachable and closable.
- [ ] Failure telemetry carries `errcode` alongside the message.
