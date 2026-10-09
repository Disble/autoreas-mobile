# settings-screen-redesign

Feature: turn the Settings screen from a runtime log into a status page. It answers one question,
"are my changes safe and reaching the PC?", with copy and tone that treat a PC that is off as the
normal state it is.

Approved mockup: https://claude.ai/artifact/LvSvbYEBnRKVKLunpqTFqN (v3).

## Why

The screen was built before telemetry existed. Today the bridge receives the result of every sync
cycle (`docs/mobile-diagnostic-telemetry.md`), and sync health is checked through the bridge MCP,
not by opening the app. What is left on screen duplicates that channel and alarms the user:

- The same "bridge unreachable" fact is shown five times across two cards.
- Two re-pair buttons. The one in `buildSettingsSyncSummary`
  (`src/features/settings/ui/SettingsScreen/settings-sync-status.helpers.ts`) shows whenever
  `pendingOpsCount > 0` and the status is not `sync_error`, so a PC that is simply off offers
  the wrong remedy.
- `buildConfiguredBackgroundSyncSection` titles any `lastFailureMessage`, including a plain
  unreachable, "Último sync con error" in `danger`.
- One pending change is enough for `warning`. A stale backlog escalates to `danger` at 5 days
  (`SYNC_VISIBLE_STATUS_STALE_DANGER_DAYS`) although nothing is lost: the data lives on the device.
- 13+ runtime counter tiles, UTC timestamps, and a raw URL as an error.
- The copy says "teléfono" on a tablet, mixes voseo ("Emparejá") with tú, and uses system words
  ("bridge", "reconciliar", "sync pendiente").

## Decisions

- Tone ladder: PC off and no Wi-Fi are `default` (neutral); a pending backlog turns `warning`
  only after 72 h without a successful sync; `danger` is reserved for `sync_error`, the
  bridge responding and rejecting. Waiting never reaches `danger`.
- Re-pair is never the primary action for a merely unreachable PC. It stays available as a
  secondary action in the connection card.
- The runtime counter grid is removed entirely, including dead-letter, exhausted conflicts and
  stuck processing (user decision, 2026-10-08): those are observed through bridge telemetry.
- User-facing headlines say "la PC". "Bridge" stays only in pairing and technical contexts.
- Copy uses tú and "dispositivo".
- No legacy code (user rule, 2026-10-08): whatever leaves the UI leaves completely, with its
  helpers, constants, types, hooks, schema fields used only by it, and tests. No dead
  re-exports, no "kept for compatibility" branches. Telemetry and the runtime snapshot are the
  replacement and stay untouched.

## Non-goals

- No change to sync behaviour, scheduling, telemetry payloads, or the runtime snapshot schema.
  The snapshot keeps being written; only Settings stops rendering the counters.
- No change to the pairing flow itself.

## Tasks

### T1 — Calm sync status semantics and copy

- Route: delegated writer (2+ non-trivial files: shared helper, Settings helper, their tests).
- Surfaces: `src/features/sync/sync-visible-status.*`, `settings-sync-status.helpers.ts`,
  `anime-list-screen.helpers.ts` (shared copy), and their tests under `tests/`.
- Apply the tone ladder and copy table from the mockup. Drop the `repair_bridge` action for
  a merely pending backlog.
- Red first: existing helper tests updated to the new expectations, observed failing.
- [x] Done — evidence: work-unit commit `fix(sync): calm the sync status copy and reserve danger for rejected syncs`. RED: 17/21 shared-status, 7/9 Settings-summary, 8/30 anime-list helper tests failed before the change. GREEN: focused Jest 115 suites / 1037 tests pass; `tsc --noEmit` clean; `lefthook run pre-commit` green. Mutations killed: deleting the `sync_error` danger branch (2 failures), deleting the 72 h warning branch (2 failures), `>=` to `>` at 72 h (1 failure). Removed: `SYNC_VISIBLE_STATUS_STALE_DANGER_DAYS`, `repair_bridge` action kind and its handler branch.

### T2 — Settings layout: one status card, no counter grid

- Route: delegated writer (multiple `.tsx`, hooks, helpers, constants, tests).
- Status card on top with one contextual action. Connection card (host, device id copyable,
  re-pair). Background section collapsed to one line unless something needs fixing (battery
  exemption, permission, service). Privacy toggle unchanged.
- Remove `SettingsMetricTile*`, the runtime tile builders, and their constants and tests.
- [x] Done — evidence: work-unit commit `feat(settings): replace the runtime log with a single sync status layout`. RED: 29/34 new helper tests (status meta, icon, action; background items; connection) failed before implementation. GREEN: focused Jest 38 suites / 373 tests; `tsc --noEmit` clean; react-doctor `--diff` no issues; `lefthook run pre-commit` green. Mutations killed on `buildSettingsBackgroundStatus`: battery branch (2 failures), foreground-service gate on the notification item (1), unsupported short-circuit (1). Manual sync wired to the existing `useSyncFacade().manualSync`. Removed: metric tile grid and builders, convergence descriptors, label maps, background section builder, `buildSettingsBridgeStatus`, the capacity-shed read, `SyncVisibleStatusFacts.syncError`.

### T3 — Documentation

- Route: inline or delegated, depending on size.
- New `docs/mobile-sync-status-ux.md`: state, copy and tone table, and the rules behind it.
- Update `docs/Autoreas_mobile_design_doc.md` §4.4.3 and `docs/mobile-diagnostic-telemetry.md`
  (counters are no longer shown in Settings), plus `docs/learning-log.md` if it applies.
- [ ] Done — evidence:

## Checks per task

- Focused Jest suites for touched helpers and hooks.
- `npx -y react-doctor@latest . --verbose --diff` after React changes.
- `npx lefthook run pre-commit` before each commit.

## Delivery

- Branch `feat/settings-screen-redesign` from `dev`. Work-unit commits per task. Local merge only.
- Forecast: more than 400 authored lines (T2 deletes a lot). Strategy: `ask-on-risk`.

## Progress

- 2026-10-08: feature document created; branch created from `dev` (0052cac).
- 2026-10-08: T1 done (delegated writer). Tone ladder and copy applied in `deriveVisibleSyncStatus`; Settings summary no longer offers re-pairing for a pending backlog; anime-list refresh-failure copy aligned. Follow-ups outside T1 surfaces: `SyncVisibleStatusFacts.syncError` is no longer read by the shared status (still fed by two hooks); `season-rating-sheet.constants.ts` still says "teléfono".
- 2026-10-08: T1 parent spot check: focused helper suites 30/30 green. Review assessment on
  `dev..bc9d915`: risk `medium`, `review_due` (slice_budget_reached, 844 lines incl. tests).
  RDD is `off` (global), so no native review; medium tier = writer self-verification (accepted).
  Delivery: local merge model, no PRs, so the >400-line chain strategy does not apply.
- 2026-10-08: T2 done (delegated writer). Settings is now status card + connection + background + privacy. Background card fixes: battery exemption (existing request), notification permission and stopped service (`Linking.openSettings`). Now dead outside T2 surfaces: the public `readShedCount` member of the diagnostics outbox store (still used internally), and `UseSyncFacadeResult.syncError` (no src reader left).
