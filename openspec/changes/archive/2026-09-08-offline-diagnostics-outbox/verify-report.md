# Verify Report: Offline Diagnostics Outbox

**Verified by the orchestrating agent directly, not delegated** (CLAUDE.md → Delegation Guardrails).
Date: 2026-09-08. Branch `feat/offline-diagnostics-outbox`. Commits `0bda070`, `654c749`, `526dfe1`.

## Verdict: PASS

## Evidence

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | **149 suites / 1007 tests, all passing** (baseline was 142/953, measured on `4e8d069`) |
| Types | `npm run typecheck` (`tsc --noEmit`) | Clean, no output |
| Lint on changed files | `npx eslint --max-warnings=0 --no-warn-ignored <33 files>` | **exit 0** — zero errors, zero warnings |
| Task completion | `grep -c '^- \[x\]' tasks.md` | **56 / 56** |
| Working tree | `git status --porcelain` | Clean |
| Slice A isolation | `git diff --name-only 4e8d069..654c749 \| grep ^src/features/` | No matches — Slice A touched zero feature files, as scoped |

Repo-wide `npm run lint` reports 194 errors, all pre-existing `dharness/*` JSDoc debt in files this
change never touched. CLAUDE.md constraint 12 records the standing baseline as 305 errors across 89
files (2026-08-29), so the debt is lower than documented, not higher. The change paid its own
per-file cost: all 33 touched files lint clean.

## The two binding guards, verified in the shipped code

**1. Disposition taxonomy — orchestrator amendment to design Decision 4.**
`src/features/sync/sync-diagnostics-flush.helpers.ts:21-23`:

```ts
function isEnvelopeRejection(status: number): boolean {
  return status === 400 || status === 413 || status === 422;
}
```

It does **not** call `isPermanentReconcileError`; that symbol appears only in comments explaining
why it is not reused. This matters because the bridge endpoint is not built yet: under the
reconcile taxonomy's blanket `>= 400 && < 500`, every POST would return `404`, every row would be
deleted, and the queue would drain silently during the dual-write window — reproducing the exact
invisible-loss failure this change exists to close.

**2. Flush placement — design Decision 5.**
`src/features/sync/reconcile.helpers.ts`:

```
:380  captureSyncDiagnosticsEnvelope(clientTelemetry)
:381  await flushSyncDiagnosticsOutbox({ connection })
:383  try {
:384    await bridgeClient.reconcile(connection, requestBody)
:472    await revertPendingOperationsOnFailure(rawDb, pendingOps, error)
```

Both calls sit **lexically before** the `try`. A diagnostics POST failure therefore cannot reach
the `catch` that calls `revertPendingOperationsOnFailure`, which would otherwise dead-letter or
requeue the user's real pending mutations because a telemetry request failed.

## Deviations from the artifacts, accepted

1. **`Date.parse` guard (design Decision 2).** The design assumed unparseable input yields `NaN`.
   Measured in V8: `Date.parse('-5')` → `988693200000` and `Date.parse('1.5')` → `978670800000`,
   both real dates. A `Retry-After: -5` would have produced a not-before timestamp in the past and
   silently disabled the backoff. Fixed with a colon-presence guard before `Date.parse`, since every
   RFC 9110 date form carries `HH:MM:SS`. Verified independently by the orchestrator.
2. **`getAllSync` added to `tests/support/sqlite-adapter.helpers.ts`.** The double implemented 7
   `SQLiteDatabase` members and lacked synchronous reads, which Decision 7 requires. RED test first.
3. **`sync-diagnostics-outbox-instance.constants.ts` added.** Without a module-level singleton every
   cycle would open a fresh, never-closed native connection to `autoreas-telemetry.db`. Mirrors the
   existing `bridge-client-instance.constants.ts` pattern; `dharness/role-file-shape` forbids a
   value singleton in a `.helpers.ts`, hence the separate file.
4. **`reconcile.helpers.test.ts` split** into `reconcile-diagnostics-wiring.test.ts` to stay under
   the 500-line rule. Duplicated `jest.mock()` boilerplate is unavoidable — those calls are
   file-scoped.

## Review budget

Both slices exceeded the session's 800-line grant and both were reset by the orchestrator with a
recorded reason; `changed_line_budget_exceeded: true` remains on both attempts in the ledger.

- Slice A: 815 lines. 15-line overage from the `getAllSync` fix, plus a 66-line docs-only commit
  sharing the attempt window.
- Slice B: 1037 lines — **769 tests, 222 production source, 46 tasks.md**. The design forecast
  ~760 test lines, so the test weight was predicted. The overage is the exhaustive per-status-code
  disposition matrix and the file-split's duplicated mocks. No assertion was weakened to fit.

## Not in scope, recommended as follow-up

- `2026-09-04-background-sync-bounded-awaits` and `2026-09-04-core-sync-behaviour-suite` are fully
  implemented in code with every `tasks.md` box unchecked. Archive candidates.
- `2026-09-04-durable-reconcile-footprint` is done except `sync_quarantine`. Narrow it.
- `2026-09-04-sync-trace-observability`'s Out-of-Scope rationale ("correlation by header is cheaper
  than ingestion") is false for the offline case — there is no bridge-side capture to correlate
  against when nothing arrives. The decision to keep it separate stands on cost and size; the
  stated reason needs correcting so nobody re-litigates it on a broken premise.

## Known limitation, by design

The bridge endpoint does not exist yet. Until it ships, every flush receives `404`, which preserves
the row and stops the batch. Rows accumulate to the 100-row cap and evict oldest-first. This is the
intended dual-write behaviour, not a defect.
