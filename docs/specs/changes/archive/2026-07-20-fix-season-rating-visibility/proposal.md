# Proposal: Fix season rating visibility

## Intent

Fix the season-mode regression where anime cards lose both the rating CTA and the existing bridge rating after websocket `preferences_changed` enables season mode before the active season snapshot is refreshed.

## Scope

### In Scope
- Refresh the active season projection from sync runtime wiring when `preferences_changed` turns season mode on.
- Preserve the current `setSeasonMode` flow and BridgeClient/WebSocket ownership boundaries.
- Add a regression test for the preferences-driven season-mode activation path.

### Out of Scope
- Changes to normal-mode card behavior.
- Changes to BridgeClient transport, websocket event ownership, or card rendering rules.
- Broad season-sync lifecycle refactors outside this bug seam.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `03-optimistic-ignorance`: websocket `preferences_changed` MUST refresh active season data when it enables season mode.
- `05-ui-split-screen`: season-mode cards MUST keep showing the rating CTA or existing rating once the active season projection is available.

## Approach

Apply the smallest runtime fix in `useSyncRuntime`: when websocket `preferences_changed` sets `season_mode` to `true`, immediately trigger the existing active-season refresh callback so `useAnimeList` rebuilds `seasonProjection`. Lock the behavior with one runtime test that proves season mode gains rating metadata without changing normal mode.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/use-sync-runtime.ts` | Modified | Refresh active season snapshot on season-mode activation |
| `tests/features/sync/use-sync-runtime.test.ts` | Modified | Regression coverage for `preferences_changed` season-mode path |
| `docs/specs/changes/fix-season-rating-visibility/proposal.md` | New | Proposal artifact for this bug fix |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate refreshes around nearby sync events | Low | Reuse existing refresh path and test only the new trigger seam |
| Hidden normal-mode regression | Low | Keep behavior gated to `season_mode === true` and preserve existing runtime flow |

## Rollback Plan

Revert the `useSyncRuntime` wiring change and its regression test. No schema, transport, or UI rollback is required.

## Dependencies

- Existing active-season refresh callback used by sync runtime hooks.

## Success Criteria

- [ ] After websocket `preferences_changed` enables season mode, cards receive refreshed season projection data.
- [ ] Season-mode cards show either the existing bridge rating or the rating CTA when applicable.
- [ ] Normal mode remains unchanged.
- [ ] BridgeClient ownership and raw transport boundaries remain unchanged.
