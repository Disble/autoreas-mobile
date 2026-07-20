# Tasks: Fix season rating visibility

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 40-90 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Runtime callback fix plus regression coverage | PR 1 | Keep test and hook change together for one focused review |

## Phase 1: Regression lock

- [x] 1.1 Red: update `tests/features/sync/use-sync-runtime.test.ts` to mock `useSeasonSync` and capture `onPreferencesChanged` from `useWebSocket`.
- [x] 1.2 Red: add scenarios proving `preferences_changed(true)` calls `refreshActiveSeason()` once and `preferences_changed(false)` does not refresh.

## Phase 2: Runtime callback repair

- [x] 2.1 Green: modify `src/features/sync/use-sync-runtime.ts` so `handlePreferencesChanged` keeps `setSeasonMode(seasonMode)` and triggers `refreshActiveSeason()` only when `seasonMode === true`.
- [x] 2.2 Green: preserve existing `useSeasonSync`, `useWebSocket`, and BridgeClient-backed transport seams; avoid changes under `src/infrastructure/api/**`.
- [x] 2.3 Refactor: keep the hook within repo anatomy order and limit the diff to the callback seam required by the design.

## Phase 3: Verification

- [x] 3.1 Run `npm test -- use-sync-runtime.test.ts` and confirm the new activation-path regression passes.
- [x] 3.2 Run `npm run lint` and `npm run typecheck` to verify the hook edit stays compliant with repo architecture and typing rules.
- [x] 3.3 Recheck the negative case from the spec: normal browsing remains unchanged when preferences keep season mode disabled.
