# Request correlation id

Objective: stamp every bridge HTTP request made within one sync cycle with `X-Autoreas-Request-Id: <cycleId>:<n>`, in both the native and the JS engine.
Branch: `feat/request-correlation-id` (worktree `autoreas-mobile-worktrees/request-correlation-id`, cut from `dev` at 5cbcaed). Delivery: local merge, `ask-on-risk`. Runners: `bun run test` (Jest) and `bun run test:kotlin`.

## Specs

- **S1 — Header format (bridge contract, agreed 2026-10-17).** "Request header `<cycleId>:<n>`, validated by `^[A-Za-z0-9._-]{1,48}:[0-9]{1,9}$`." "n is the request's sequence within its cycle." The value is ASCII-only, at most 58 chars. A cycleId is a lowercase UUID (36 chars).
- **S2 — Optional and additive.** "An absent or invalid value is ignored, and the bridge mints its own id." A request made outside a sync cycle (UI screens, pairing, covers) sends NO header, so its current headers stay byte-identical. Calls without a request id behave exactly as today.
- **S3 — Native engine.** "You can add the header to SyncEngineHttp.kt and buildBridgeHeaders whenever you like." The native attempt's existing `cycleId` (SyncForegroundService.kt / SyncFloorAttempt.kt) is the prefix. Every bridge request in one attempt takes the next n, starting at 1: the presence probe, the diagnostics drain, the fetch-first GET, every reconcile POST including the one-message-per-request re-sends, and the season-rating POSTs.
- **S4 — JS engine.** "The JS path mints its own UUID per cycle with the same shape." One UUID per foreground cycle. Every bridge request made by that cycle takes the next n: the diagnostics flush, getAnime for missing tokens, every reconcile including isolation re-sends, the season-rating posts, and the active-season refresh.
- **S5 — Phone-side logging.** The phone's existing per-request log lines carry the request id when there is one, so a phone log line can be joined to the bridge record. The echoed response header MAY be ignored: "Nothing requires it."
- **S6 — No WebSocket change.** "No WS change."

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2, S3, S5 | delegated writer (Writer trigger a, parallel with T2) | done. RED: compile failure; GREEN: test:kotlin 423/0. S5 partial: Log.d per request in SyncEngineHttp, no id in the MissingTokenResolver/SeasonRatingSender Log.w lines | 4683ce9 |
| T2 | S1, S2, S4, S5 | delegated writer (Writer trigger a, parallel with T1) | done. RED: missing module + 9 failing client tests; GREEN: jest 2159/2159, typecheck, eslint. Snapshot heal left unnumbered (optional) | see git log |
| T3 | all | inline seam check | done: test:coverage 241/2159 green; lefthook gate green on both commits | 4683ce9 + JS commit |

## Log

- L1 (2026-10-17, user): "Ajá. En este caso, hazlo en un worktree, porque Bridge puede que le tome mucho tiempo y quién sabe si haga cambios. Entonces, por si acaso, hazlo en un worktree."
- L2 (2026-10-17, bridge session): the contract is quoted in S1-S6. Bridge committed the announcement in docs/openapi.yaml on its branch `feat/debug-capture`, which is not merged. The bridge today ignores unknown headers.
- L3: explorer map. Native: the counter is per attempt, built in `SyncEngineRunner.runOnce` (the probe runs before `SyncEngineCycle` exists). There are 5 `SyncEngineHttp` call sites. JS has no cycle id today. The cycle starts in `runCoordinatedForegroundSyncCycle` (sync-facade.helpers.ts:116). The context is spread per round, so the counter must be a shared mutable object.
- L4: seam check green. JS decision: the sequence lives in src/features/sync/request-id.*; resyncFromBridgeSnapshot (heal) sends no id. ActiveSeasonSyncError moved to season-sync.errors.ts to pass the lint gate on a touched file. Risk: none (optional header; calls without an id stay byte-identical, pinned by tests on both sides). Not merged: the user is away, and merges wait for them.
- L5 (2026-10-18, user): "Hubo una gran update en la rama dev. actualiza esta rama con lo de dev y resuelve conflictos." Merged dev (2.0.0). Dev retired the season pull: the active-season refresh, season-sync and getActiveSeason were removed, so S4's "active-season refresh" item no longer exists. The facade's new pull after a delivered rating now shares the cycle's sequence. Dev's native background cover catch-up (`getBytes`) sends no id, like the JS covers. Checks: typecheck clean, test:kotlin BUILD SUCCESSFUL, jest 243/2178 green.
