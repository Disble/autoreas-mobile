# Proposal: Durable Reconcile Footprint

## Intent

The bridge accepted five reconciles from this device and the phone kept no evidence that any of them happened. Measured server-side: **0 cursor advances out of 97 requests** in the 600-second band, across four devices, 77 % of them carrying a non-empty `pending_operations`. The bridge wrote its side; the phone shows nothing, diagnoses nothing, and retries the same operations forever.

Two source-verified defects sit under that.

**R2 — a `202` can leave no durable footprint.** The post-response work is not one transaction with a typed failure path, so a partially-applied cycle is indistinguishable from one that never ran. There is no state that says "the bridge accepted this and we failed to record it".

**A10 — an `update` for an unknown record is dropped *and counted as applied*.** Verified at `src/features/sync/merge/apply-remote-changes.helpers.ts:22-40`: the existence check at `:24-33` runs **only when `changed_fields` is empty**. When the bridge sends `change_type: "update"` with non-empty `changed_fields` for a record the device has never seen — which is what it emits for anything created on the PC while the phone was offline — control falls through to `applyAnimePartial`, an `UPDATE ... WHERE _id = ?` that matches **zero rows**. `applyAcceptedChange` then returns `true`, so `applyRemoteChanges` does `applied += 1`.

That second half is the part that matters most. The record is not merely lost; **the diagnostic counter reports success for a write that never happened.** Any measurement campaign that trusts `applied` is reading a fabricated number, which makes this a prerequisite for the whole measurement strategy, not just a data-loss bug.

## Scope

### In Scope

- **D1** — cursor advance and operation confirmation become one transaction. Either both land, or a typed failure carrying `stage` (`parse | mapping | write | transport | scheduler`) and an `errcode` is recorded and surfaced.
- **A10 fix** — hoist the existence check out of the `changed_fields.length === 0` branch so an `update` for an unknown `_id` upserts regardless of whether `changed_fields` is populated. `applyAcceptedChange` must return `false` when nothing was written, so `applied` stops lying.
- The `sync_quarantine` table — schema, `REQUIRED_SCHEMA_TABLES` entry, migration — **created but not yet advancing the cursor**. Capture-before-advance is a later behaviour; this change only lands the durable place to put it.
- Delete the dead `409` branch (H13).
- One `ARCHITECTURE.md` sentence recording the second database file.

### Out of Scope

- Enabling quarantine-driven cursor advance. The table lands empty and unused.
- The trace subsystem (MB-0b) and the policy/status split (MB-2a).
- Any change to merge or conflict semantics beyond the A10 existence check.
- Anything requiring a device.

## Capabilities

### Modified Capabilities
- `write-failure-diagnostics`: adds the typed `stage`/`errcode` taxonomy for a reconcile cycle, and the rule that an accepted response always leaves either a commit or a typed failure.

### New Capabilities
- `background-sync-delivery`: a `202` leaves a durable local footprint; `applied` counts only writes that actually occurred.

## Approach

The A10 fix is three lines and the honesty fix is one. The valuable part is not the repair but the assertion that survives it: the core behaviour suite (`2026-09-04-core-sync-behaviour-suite`, task T15) already characterizes the current broken behaviour with a test named `characterizes A10: update for unknown _id is silently dropped`. **This change inverts that test.** That inversion is the proof the fix landed — a defect that was executable documentation becomes an executable guarantee, and the diff between the two states is visible in one file.

The transaction work is ordinary but must not be split for convenience: a cursor that advances without its operations confirmed is precisely the drift that produced the current state.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/merge/apply-remote-changes.helpers.ts` | Modified | Hoist the existence check; return `false` when no row was written |
| `src/features/sync/reconcile.helpers.ts` | Modified | One transaction for cursor + confirmation; typed failure path; remove dead `409` |
| `src/infrastructure/db/schema` + `migrations/0010_*` | New | `sync_quarantine` table |
| `src/infrastructure/db/startup/` | Modified | `REQUIRED_SCHEMA_TABLES` entry |
| `tests/behaviour/sync/inbound-changes.behaviour.test.ts` | Modified | The A10 characterization is inverted to assert the fix |
| `tests/features/sync/__tests__/` | New/Modified | Transaction atomicity, typed failure taxonomy, `applied` honesty |
| `ARCHITECTURE.md` | Modified | One sentence: the second database file |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Dropping a `REQUIRED_SCHEMA_TABLES` entry breaks readiness for every actor** | Low but severe | The table is added, never removed; rollback leaves it in place empty, which is the safer direction |
| The A10 fix upserts a record that should have been rejected by the merge boundary | Medium | The outbox guard and staleness guard run *before* `applyAcceptedChange`; the fix changes only what happens after a change is already accepted |
| `applied` changing meaning breaks a caller that relied on the inflated count | Medium | Enumerate `ApplyRemoteChangesResult.applied` consumers before changing it; the count was wrong, so any caller depending on the old value was already wrong |
| Migration `0010` conflicts with a concurrent migration | Low | Sequential numbering is checked at design time |
| Staged files inherit `dharness` JSDoc debt | High | JSDoc written as part of each edit (constraint 12) |

## Rollback Plan

Revert the commit; leave the `sync_quarantine` table in place. Dropping a `REQUIRED_SCHEMA_TABLES` entry is the more dangerous operation, so the rollback deliberately leaves an unused empty table rather than removing it.

## Dependencies

- `2026-09-04-core-sync-behaviour-suite` must land first — it owns the A10 characterization this change inverts, and the regression harness for the transaction work.
- MB-0a (`2026-09-04-background-sync-bounded-awaits`) should land first so the typed failure taxonomy has bounded cycles to describe.

## Success Criteria

- [ ] A `202` leaves either a commit or a typed failure with `stage` and `errcode`. No third outcome exists.
- [ ] The cursor never advances without its confirmed operations landing in the same transaction.
- [ ] An `update` for an unknown `_id` upserts the record, with `changed_fields` populated or empty.
- [ ] `applyAcceptedChange` returns `false` when no row was written, and `applied` counts only real writes.
- [ ] The core suite's A10 characterization is inverted and passes.
- [ ] `sync_quarantine` exists, is in `REQUIRED_SCHEMA_TABLES`, and is not yet written to.
- [ ] The dead `409` branch is gone.
- [ ] Regression floor holds: 109 suites / 654 tests plus the core behaviour suite, all green.
