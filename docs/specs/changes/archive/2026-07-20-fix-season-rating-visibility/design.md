# Design: Fix season rating visibility

## Technical Approach

Implement the smallest runtime-only repair in `useSyncRuntime`. When the WebSocket `preferences_changed` callback turns `season_mode` on, the runtime will keep the existing store update and immediately invoke the already-owned `refreshActiveSeason` callback from `useSeasonSync`. This follows the proposal and satisfies the delta spec by restoring season projection through the current BridgeClient-backed path. No UI files, card rules, or raw transports change.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Refresh seam | Trigger from `useSyncRuntime`, trigger from UI/list layer, broaden reconcile flow | Trigger from `useSyncRuntime` preferences callback | The bug starts in runtime wiring. This seam already owns `onPreferencesChanged`, has `refreshActiveSeason`, and preserves the delivery-layer and BridgeClient boundaries. |
| Refresh condition | Refresh on every preferences push, refresh only when `season_mode` becomes `true` | Refresh only on enable | The spec asks for the activation path. This keeps normal browsing stable and avoids unnecessary season fetches when the flag stays `false`. |
| Regression coverage | UI test, list integration test, runtime hook test | Runtime hook test | The defect is callback orchestration, not rendering. The existing `use-sync-runtime.test.ts` harness already captures WebSocket callbacks cleanly. |

## Data Flow

`useWebSocket` frame  
→ `onPreferencesChanged(seasonMode)` in `useSyncRuntime`  
→ `setSeasonMode(seasonMode)`  
→ if `seasonMode === true`, call `refreshActiveSeason()`  
→ `useSeasonSync` fetches active season through existing bridge helpers  
→ active-season store updates  
→ downstream list rebuilds `seasonProjection`  
→ season card regains rating CTA or existing rating

## File Changes

| File | Action | Description |
|---|---|---|
| `src/features/sync/use-sync-runtime.ts` | Modify | Extend `handlePreferencesChanged` so season-mode activation triggers the existing `refreshActiveSeason()` path after updating the store. |
| `tests/features/sync/use-sync-runtime.test.ts` | Modify | Mock `useSeasonSync` and add a regression test that proves `preferences_changed(true)` refreshes the active season while `false` does not. |
| `docs/specs/changes/fix-season-rating-visibility/design.md` | Create | Records the runtime-only design for the change. |

## Interfaces / Contracts

No public contract changes. Existing callback signatures stay intact:

```ts
onPreferencesChanged?: (seasonMode: boolean) => void;
refreshActiveSeason: () => Promise<void>;
```

The implementation only composes these existing contracts inside `useSyncRuntime`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/runtime hook | `preferences_changed(true)` triggers one active-season refresh | Extend `use-sync-runtime.test.ts` by capturing the WebSocket callback and asserting the mocked `refreshActiveSeason` call. |
| Unit/runtime hook | `preferences_changed(false)` keeps normal-mode path unchanged | In the same test area, assert no refresh call for `false`. |
| Integration/E2E | None for this slice | Existing runtime seam test is enough because UI behavior already derives from refreshed season projection. |

## Migration / Rollout

No migration required.

## Open Questions

- [ ] None.
