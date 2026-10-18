# Background covers and season mode

Objective: animes that reach the tablet while the app is in the background open with their cover and their season controls already in place. Also the tablet sidebar and the season-card cover gap.
Branch: `fix/background-covers-season` (worktree `autoreas-mobile-worktrees/background-covers-season`). Delivery: local merge by the user. Runners: Jest (`bunx jest`), Kotlin (`bun run test:kotlin`).

## Specs

- S1 (L1): "En segundo plano no está sincronzinado bien dos cosas. Primero, los covers no están sincronzinando en segundo plano."
  The native background cycle downloads the covers of active animes that have no cover entry yet (animes already in the list or staged by the same background sync). The app adopts them the next time it hydrates covers (mount or return to foreground), without waiting for its own sync.
- S2 (L1): "Tampoco se sincronizó o al menos no se activo el modo temporada de los animes que estában en los "días" de temporada, tiene la captura de Ver hoy, por lo que no podía poner nota."
  The native background cycle refreshes the active season (200 → cache upsert, 404 → cache delete, anything else → keep) into `active_season_cache`, which the app already reads when it returns to the foreground.
- S3 (L1): "tienes un bug de UI con la parte inferior del cover con la card" / "espacio sobrante de cover en modo temporada". The cover fills the whole card height.
- S4 (L2): "El modo de menu en sidebar dejó de aparecer y se quedó en el modo mobile a full screen en tablet." Full-screen tablet shows the day sidebar again.

## Tasks

- T1 S4 inline — done, `c69516e` (layout from the measured root frame).
- T2 S3 inline — done, `0783830` (cover fills the column).
- T3 S2 inline — done, `7c1a8ca` (native season refresh after a `closed` background attempt; 25 Robolectric tests, Kover gate green).
- T4 S1 inline — native prefetch in `7c1a8ca`; JS adoption in `hydrateCoverUrisUnlocked` in the JS commit after it.

Route: inline for all (no writer trigger: T3/T4 share the post-cycle hook in `SyncEngineRunner`).

## Log

- L1 (2026-10-18, user): "Dame viendo esto en un worktree. En segundo plano no está sincronzinado bien dos cosas. Primero, los covers no están sincronzinando en segundo plano. Tampoco se sincronizó o al menos no se activo el modo temporada de los animes que estában en los "días" de temporada, tiene la captura de Ver hoy, por lo que no podía poner nota. Adicional, tienes un bug de UI con la parte inferior del cover con la card. Resuelve esos bugs."
- L2 (2026-10-18, user): "Y te sumo uno nuevo. El modo de menu en sidebar dejó de aparecer y se quedó en el modo mobile a full screen en tablet."
- L3 evidence: bridge request log shows no `/api/seasons/active` and no `/cover` request between 2026-10-17 19:32 UTC and 2026-10-18 05:44 UTC while `native_fgs_tick` reconciles ran every ~105 s; the native engine only reconciles. New season candidates `BAD0XfDkcydwuhzx`, `rKpeecjb3weNygDD` appeared in that window.
- L4 evidence (S4): in the full-screen screenshot the card measures ~1317 dp wide (≥ 1280 → tablet-landscape), yet the compact layout rendered: `useWindowDimensions` kept the split-screen width. RN re-reads window metrics on rotation, not on leaving split screen.
- L5 decision (T4): native never writes `covers/manifest.json` (the JS sweep rewrites it from memory and deletes unreferenced files). It writes `covers-inbox/<sanitizedId>.jpg` then `<sanitizedId>.json` (both temp + rename); JS adopts only complete pairs under its cover mutex. Native fetches only animes with no manifest entry and no inbox pair; revalidation stays in JS.
- L6 (2026-10-18): T3 and native T4 share `SyncEngineBackgroundCatchUp.kt`, so they landed in one commit. `bun run test:kotlin` green incl. `koverVerifyCoreFloorRunner`; Jest sync + cover-files 661/661. A first Kotlin run failed in `expo-modules-core:compileDebugJavaWithJavac` from a stale Gradle build cache; `--no-build-cache --rerun-tasks` on that module fixed it. APK/device check waits for the next mobile release.
