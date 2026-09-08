# Archive Report — Offline Diagnostics Outbox

Closed: 2026-09-08
Status: **applied, verified, merged**

## What this change fixed

When a sync cycle builds a `client_telemetry` diagnostic envelope describing how the previous cycle ended, that envelope today has nowhere durable to land. It rides only on the reconcile request carrying the cycle's pending mutations, so when that request fails to reach the bridge — the normal case for an offline-first app — the freshly built envelope is discarded with it, erasing the evidence of why the sync failed just as that evidence becomes most valuable.

This change captures the envelope durably **before** transmission is attempted, delivers it opportunistically on any later sync cycle regardless of trigger, and bounds the resulting diagnostics outbox so a device that never reconnects cannot grow it without limit.

## Technical approach

**Write the envelope down before you try to send it, then let every existing trigger drain the queue.**

Three seams, no new scheduler, no new timer:

1. **Wire type** — `degraded` becomes a field of `WireSyncCycleTelemetry` itself, set by `capWireSyncCycleTelemetry` as it sheds. The outbox row stores the serialized wire object verbatim, so the reconcile body and the row share one identity, not two independent consumers of one value.
2. **Store** — `sync_diagnostics_outbox` in the existing `autoreas-telemetry.db`, synchronous `runSync`/`getAllSync` on a private connection, cap and FIFO eviction enforced in SQL.
3. **Flush** — an unconditional, never-rejecting attempt inside `performSyncPendingOperations`, lexically outside the reconcile `try`, gated by a clock comparison folded into the candidate `SELECT`.

## Delivered

Two slices, two sequential local commits on `feat/offline-diagnostics-outbox`:

| Commit | Slice | Focus |
|---|---|---|
| `0bda070` | A | Diagnostics outbox store, bridge-client `Retry-After` parsing, `postSyncDiagnostics`, fake-bridge header extension |
| `654c749` | B | `degraded` on wire type, `sync-diagnostics-flush`, wiring into `reconcile.helpers.ts` |
| `526dfe1` | docs | Docs commit (v-tag record, Node 20 deprecation) |

Final state: **56 / 56 tasks complete**. Full suite: **149 suites / 1007 tests, all passing** (baseline 142/953). Linting clean across all 33 touched files.

## Verification at close

Performed by the orchestrating agent directly, not delegated:

- `npm test` → **149 suites / 1007 tests, all passing** (7 new suites, 54 new tests)
- `npm run typecheck` (`tsc --noEmit`) → clean
- `npx eslint --max-warnings=0 --no-warn-ignored {33 files}` → **exit 0** — zero errors, zero warnings
- Task completion audit → **56 / 56 unchecked** ✅
- Working tree → clean
- Slice A isolation → zero feature files touched (scoped correctly)

Repo-wide `npm run lint` reports 194 errors, all pre-existing `dharness/*` JSDoc debt. The change paid per-file: all 33 touched files lint clean.

Every commit passed the real pre-commit gate (fallow, typecheck, eslint, full Jest, Stryker). `--no-verify` was never used.

## The two binding guards, verified in shipped code

**1. Disposition taxonomy — orchestrator amendment to design Decision 4.**

`src/features/sync/sync-diagnostics-flush.helpers.ts:21-23`:

```ts
function isEnvelopeRejection(status: number): boolean {
  return status === 400 || status === 413 || status === 422;
}
```

It does **not** call `isPermanentReconcileError` (which uses a blanket `>= 400 && < 500` rule). The distinction matters because the bridge endpoint is not built yet: under the blanket rule, every POST would return `404`, every row would be deleted, and the queue would drain silently during the dual-write window — reproducing the exact invisible-loss failure this change exists to close. This custom taxonomy drops only what is wrong with THIS envelope, preserves anything wrong with the link or endpoint.

**2. Flush placement — design Decision 5.**

`src/features/sync/reconcile.helpers.ts:380-381`:

```
:380  captureSyncDiagnosticsEnvelope(clientTelemetry)
:381  await flushSyncDiagnosticsOutbox({ connection })
:383  try {
:384    await bridgeClient.reconcile(connection, requestBody)
:472    await revertPendingOperationsOnFailure(rawDb, pendingOps, error)
```

Both flush calls sit **lexically before** the `try`. A diagnostics POST failure therefore cannot reach the `catch` that calls `revertPendingOperationsOnFailure`, which would otherwise dead-letter or requeue the user's real pending mutations because a telemetry request failed.

## Deviations from the artifacts, accepted

1. **`Date.parse` guard (design Decision 2).** The design assumed unparseable input yields `NaN`. Measured in V8: `Date.parse('-5')` → `988693200000` and `Date.parse('1.5')` → `978670800000`, both real dates. A `Retry-After: -5` would have produced a not-before timestamp in the past and silently disabled backoff. Fixed with a colon-presence guard before `Date.parse`, since every RFC 9110 date form carries `HH:MM:SS`. Verified independently by the orchestrator.

2. **`getAllSync` added to `tests/support/sqlite-adapter.helpers.ts`.** The double implemented 7 `SQLiteDatabase` members and lacked synchronous reads, which design Decision 7 requires. RED test written first.

3. **`sync-diagnostics-outbox-instance.constants.ts` added.** Without a module-level singleton every cycle would open a fresh, never-closed native connection to `autoreas-telemetry.db`. Mirrors the existing `bridge-client-instance.constants.ts` pattern; `dharness/role-file-shape` forbids a value singleton in a `.helpers.ts`, hence the separate file.

4. **`reconcile.helpers.test.ts` split** into `reconcile-diagnostics-wiring.test.ts` to stay under the 500-line rule. Duplicated `jest.mock()` boilerplate is unavoidable — those calls are file-scoped.

## Review budget

Both slices exceeded the session's 800-line grant and both were reset by the orchestrator with a recorded reason; `changed_line_budget_exceeded: true` remains on both attempts in the native attempt ledger.

- Slice A: 815 lines. 15-line overage from the `getAllSync` fix, plus a 66-line docs-only commit sharing the attempt window.
- Slice B: 1037 lines — **769 tests, 222 production source, 46 tasks.md**. The design forecast ~760 test lines, so the test weight was predicted. The overage is the exhaustive per-status-code disposition matrix and the file-split's duplicated mocks. No assertion was weakened to fit.

## Known limitation, by design

The bridge endpoint does not exist yet. Until it ships, every flush receives `404`, which preserves the row and stops the batch. Rows accumulate to the 100-row cap and evict oldest-first. This is the intended dual-write behaviour, not a defect.

## Open follow-ups — carry forward from verify-report

1. **`2026-09-04-background-sync-bounded-awaits` and `2026-09-04-core-sync-behaviour-suite` are fully implemented in code with every `tasks.md` box unchecked. Archive candidates.**

2. **`2026-09-04-durable-reconcile-footprint` is done except `sync_quarantine`. Narrow it.**

3. **`2026-09-04-sync-trace-observability`'s Out-of-Scope rationale ("correlation by header is cheaper than ingestion") is false for the offline case — there is no bridge-side capture to correlate against when nothing arrives. The decision to keep it separate stands on cost and size; the stated reason needs correcting so nobody re-litigates it on a broken premise.**

## Spec and artifacts synced

- Delta spec `sync-diagnostics-delivery` merged into `openspec/specs/sync-diagnostics-delivery/spec.md` (new capability, no existing spec modified)
- Change folder archived at `openspec/changes/archive/2026-09-08-offline-diagnostics-outbox/`
- Proposal, design, tasks, verify-report preserved with full traceability
