# Background covers and season mode

Objective: animes that reach the tablet while the app is in the background open with their cover and their season controls already in place. Also the tablet sidebar and the season-card cover gap.
Branch: `fix/background-covers-season` (worktree `autoreas-mobile-worktrees/background-covers-season`). Delivery: local merge by the user. Runners: Jest (`bunx jest`), Kotlin (`bun run test:kotlin`).

## Specs

- S1 (L1): "En segundo plano no está sincronzinado bien dos cosas. Primero, los covers no están sincronzinando en segundo plano."
  The native background cycle downloads the covers of active animes that have no cover entry yet (animes already in the list or staged by the same background sync). The app adopts them the next time it hydrates covers (mount or return to foreground), without waiting for its own sync.
- S2 (L1): "Tampoco se sincronizó o al menos no se activo el modo temporada de los animes que estában en los "días" de temporada, tiene la captura de Ver hoy, por lo que no podía poner nota."
  Rewritten by L7-L9: season state reaches the device on the anime sync path (reconcile changes feed + anime snapshot), per the bridge contract agreed with bridge-season. The separate season read paths (`GET /api/seasons/active`, WS `season_changed`, `active_season_cache`) are removed with no legacy left. Blocked on the bridge contract ping.
- S3 (L1): "tienes un bug de UI con la parte inferior del cover con la card" / "espacio sobrante de cover en modo temporada". The cover fills the whole card height.
- S4 (L2): "El modo de menu en sidebar dejó de aparecer y se quedó en el modo mobile a full screen en tablet." Full-screen tablet shows the day sidebar again.

## Tasks

- T1 S4 inline — done, `c69516e` (layout from the measured root frame).
- T2 S3 inline — done, `0783830` (cover fills the column).
- T3 S2 — REOPENED (L9). The native season refresh in `7c1a8ca` contradicted convergent-sync L28 and was removed in `6801e4c`. The new work is split into T5-T7 against bridge `a4f0a85a` (L12).
- T5 S2 inline — carry `MobileAnime.season` into `animes.season` (migration 0021 + repair twin, wire/legacy mapping in JS and Kotlin, merge field, resync heal, shared contract case).
- T6 S2 delegated (writer trigger: context backstop, ~40 files) — read `season_mode` from the HTTP reconcile into `bridge_config.season_mode` (JS + Kotlin), drive the UI from `animes.season` + `season_mode`, and delete GET /api/seasons/active, WS `season_changed`/`preferences_changed`, `active_season_cache` and the Zustand season store.
- T7 S2 inline — send `season_id` with every rating (JS + Kotlin).
- T4 S1 inline — native prefetch in `7c1a8ca`; JS adoption in `hydrateCoverUrisUnlocked` in the JS commit after it.

Route: inline for all (no writer trigger: T3/T4 share the post-cycle hook in `SyncEngineRunner`).

## Log

- L1 (2026-10-18, user): "Dame viendo esto en un worktree. En segundo plano no está sincronzinado bien dos cosas. Primero, los covers no están sincronzinando en segundo plano. Tampoco se sincronizó o al menos no se activo el modo temporada de los animes que estában en los "días" de temporada, tiene la captura de Ver hoy, por lo que no podía poner nota. Adicional, tienes un bug de UI con la parte inferior del cover con la card. Resuelve esos bugs."
- L2 (2026-10-18, user): "Y te sumo uno nuevo. El modo de menu en sidebar dejó de aparecer y se quedó en el modo mobile a full screen en tablet."
- L3 evidence: bridge request log shows no `/api/seasons/active` and no `/cover` request between 2026-10-17 19:32 UTC and 2026-10-18 05:44 UTC while `native_fgs_tick` reconciles ran every ~105 s; the native engine only reconciles. New season candidates `BAD0XfDkcydwuhzx`, `rKpeecjb3weNygDD` appeared in that window.
- L4 evidence (S4): in the full-screen screenshot the card measures ~1317 dp wide (≥ 1280 → tablet-landscape), yet the compact layout rendered: `useWindowDimensions` kept the split-screen width. RN re-reads window metrics on rotation, not on leaving split screen.
- L5 decision (T4): native never writes `covers/manifest.json` (the JS sweep rewrites it from memory and deletes unreferenced files). It writes `covers-inbox/<sanitizedId>.jpg` then `<sanitizedId>.json` (both temp + rename); JS adopts only complete pairs under its cover mutex. Native fetches only animes with no manifest entry and no inbox pair; revalidation stays in JS.
- L6 (2026-10-18): T3 and native T4 share `SyncEngineBackgroundCatchUp.kt`, so they landed in one commit. `bun run test:kotlin` green incl. `koverVerifyCoreFloorRunner`; Jest sync + cover-files 661/661. A first Kotlin run failed in `expo-modules-core:compileDebugJavaWithJavac` from a stale Gradle build cache; `--no-build-cache --rerun-tasks` on that module fixed it. APK/device check waits for the next mobile release.
- L7 (2026-10-18, user): "Haz validado que modo temporada esté alineada con la nueva arquitectura de sync?"
- L8 (2026-10-18, evidence): the bridge log disproves L3's claim about the overnight window. The native engine delivered the rKpee episode +1 at 05:45:36 UTC, the bridge recomputed the season and broadcast `season.changed` at 05:45:42 to 0 clients, and JS pulled `/api/seasons/active` at 05:45:57 on resume. Root cause: season candidacy is derived from anime state but travels only on its own pull/push path. `MobileAnime` has no season fields. The native refresh also contradicts convergent-sync L28 ("Kotlin does not refresh the season (JS owns `active_season_cache`)").
- L9 (2026-10-18, user): "revisa, porque hasta ahora season siempre por alguna razón trabaja por separado y desde la última update de arquitectura de sync se declaró que season no puede tener rutas propias y debe ceñirse a las rutas de anime de la nueva arquitectura" / "sí, hazlo y coordina autonomamente con bridge, es el equipo bridge-season. Recuerda no dejar legacy de esa viejas rutas de seson, que por eso seguimos arreglando bugs". Proposal sent to bridge-season: optional `season` on MobileAnime plus a changelog entry whenever an anime's season projection changes; the open questions are season_mode transport and folding ratings into the reconcile. bridge-season agreed with the revert and will reply with the exact diff and the release order. Do not implement before that ping.
- L10 (2026-10-18, bridge-season contract ACCEPTED):
  - MobileAnime gains optional `season: {seasonId: string, grade: int|null}` (no gradeSource). It is joined at serve time on GET /api/animes, GET /api/animes/{id} and every changes/reconcile row; absent means not a candidate of the open season.
  - Each projection change appends an `update` row with changed_fields ["season"] and the full snapshot. Season open, close and replace produce one row per affected anime, and the startup diff backfills.
  - ReconcileResponse gains `season_mode` (bool, always present), meaning "an open season exists". A season with zero candidates still sets it true.
  - POST /api/seasons/active/ratings stays, with its fates unchanged. A 204 yields a ["season"] row through the cursor.
  - Release: bridge vN additive → mobile drops GET /api/seasons/active, WS season_changed and preferences_changed, and reads season_mode from the reconcile → bridge vN+1 deletes those paths and contracts.
  - Mobile asked bridge to confirm that a ["season"] row does not bump `modified_at` and that its change timestamp stays monotonic.
  - Installed builds reject and acknowledge ["season"] rows (fail-closed), so they are safe.
  - Waiting for the vN ping before implementing.
- L11 (2026-10-18, bridge-season):
  - Confirmed that a ["season"] row keeps the anime's current `modified_at` and stamps a strictly increasing timestamp. Bridge pins both with tests, and season never enters snapshot_json.
  - Grade range is 1–6.
  - Upgrade gap: installed builds ack the backfill rows without applying them. The mount/resume snapshot heal (R-7) closes it once `season` is a compared field, so no cursor reset or re-emit is needed.
  - Bridge adds an optional `season_id` to POST /api/seasons/active/ratings in vN. On a mismatch it returns 404, so the rating becomes unresolved with `not_found`. Mobile always sends it, taken from the queued payload's seasonId.
- L12 (2026-10-18, bridge-season vN ping): implement against bridge `feat/season-on-anime-sync` tip `a4f0a85a` (not on bridge dev yet). Corrections:
  - `season_mode` comes only in the HTTP POST /api/sync/reconcile response. The WS `{"type":"reconcile"}` message has no response body.
  - The WS `anime_changed` payload for a ["season"] row is the stored snapshot, which never carries `season`. Mobile treats it only as a nudge to reconcile and never reads candidacy from it.
  - The inbound WS `season_rating` message is unchanged. Mobile never sends it (grep), so bridge retires it in vN+1.
  - Rating with a matching `season_id` → 204. Rating for another season → 404 `{"error":"not a season candidate"}`.
  - A grade the bridge rejects with 409 records no row.
  - The first bridge start after upgrade backfills one row per candidate.
- L13 (2026-10-18, T6 writer evidence, S2): implemented and NOT closed; one open decision.
  - Done:
    - JS and Kotlin read `season_mode` from the reconcile answer and write `bridge_config.season_mode` with the cursor, only when the answer states it. A null value is rejected in both runtimes (zod `.optional()` parity), and shared rejection fixtures pin it.
    - The UI takes season mode from `config?.seasonMode === true`, builds the projection from `anime.season`, and queues each rating with that anime's seasonId.
    - Deleted the old paths: `GET /api/seasons/active`, the WS season and preference events with their flush reasons, the season store, season-sync, `LOCAL_ACTIVE_SEASON_ID` and `bridgeRatingSource`.
    - `active_season_cache` is now `DROP TABLE IF EXISTS` in the same ensure position, and the required tables go from 8 to 7.
    - Docs updated: `mobile-sync-engine-workflow.md`, `Autoreas_mobile_design_doc.md`, `mobile-sync-architecture.md`.
  - Checks:
    - `bun run typecheck`: exit 0.
    - `bun run test:kotlin`: BUILD SUCCESSFUL.
    - `bunx eslint <touched>`: exit 0.
    - `react-doctor --diff`: no issues.
    - Final grep: only the DROP step, its tests, and the WS test proving the retired frames are ignored.
    - `bunx jest`: 2147/2149. The 2 failures are `contract-fixtures.behaviour.test.ts` `rating-204-is-delivered` and `rating-5xx-stays-pending-and-is-resent-identically`.
  - Open decision: JS now runs one extra pull inside `syncPendingOperations` after a 204 rating. Kotlin has no such pull, and `SyncEngineCycle.kt` is outside T6's surface. So the shared rating fixtures (both runtimes, ADR 009 R-4/R-10) see an extra `POST /api/sync/reconcile` in JS only. Either the pull moves to the foreground facade (where the old refresh lived; the fixtures stay as they are), or Kotlin gains the same pull and the fixtures expect it.
- L14 (2026-10-18, parent decision on L13):
  - The pull after a delivered rating moved to the foreground facade. `syncPendingOperations` reports `ratingDelivered`, and `runCoordinatedForegroundSyncCycle` runs one more outbox pass as a best-effort step.
  - The shared rating fixtures stay byte-identical, so both runtimes still send the same requests. A rating the background engine delivers gets its grade on the next cycle; resume always heals.
  - Facade tests pin the cases: two passes on delivery, one otherwise, and a failed pull never fails the cycle.
  - The pre-commit gate also dropped the two deleted files from `jest.coverage-tiers.js`.
  - Results: full `bunx jest` 2151/2151, `bun run typecheck` exit 0, `npx lefthook run pre-commit` exit 0.
  - Retired names now appear only in historical docs (dated redesign draft, archived specs), which stay as they are.
