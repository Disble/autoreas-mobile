# Episode durations and long-episode mark

Objective: carry the bridge's per-episode durations (`MobileAnime.episodes`) end-to-end and show the "long next episode" mark on the anime card, offline-first.
Branch: `feat/episode-durations` (from `main` @ b8da9ad) · Delivery: `ask-on-risk` · Runner: `bun run test` (Jest), `bun run test:kotlin` (native), gate `npx lefthook run pre-commit`.

## Specs

- **S1 — Wire field.** Accept the bridge contract verbatim:
  `"episodes": [ { "episode": 1, "minutes": 24, "long": false }, { "episode": 2, "minutes": 46, "long": true } ]`
  "`EpisodeLength`: `episode` int ≥ 1 · `minutes` int ≥ 0 (runtime guardado, redondeado al minuto) · `long` bool. Todos requeridos."
  It arrives in "`GET /api/animes`, `GET /api/animes/{id}` y cada `AnimeChange.snapshot`". Mobile consumes `GET /api/animes` (initial sync and foreground resync) and `bridge_changes[].snapshot` of `POST /api/sync/reconcile`, both JS (foreground) and Kotlin (native background engine).
- **S2 — Replace, never merge.** "Campo AUSENTE = "sin duraciones". Reemplacen su copia entera, no hagan merge." A change with `changed_fields: ["episodes"]` and no `episodes` key clears the local copy.
- **S3 — Durations-only updates are applied.** "Un cambio que solo tocó duraciones llega como `update` normal con `changed_fields: ["episodes"]`": `episodes` must survive `changed_fields` normalization in TS and Kotlin and be written through the partial-update merge path.
- **S4 — Offline persistence.** Durations are stored on the `animes` row (new nullable JSON text column `episodes`), so the mark shows without a connection. The migration ships with its idempotent repair twin and readiness bump (TS and Kotlin).
- **S5 — Backfill.** Animes already synced before the upgrade receive their durations without a bridge-side change, through the existing foreground resync (`resyncFromBridgeSnapshot`).
- **S6 — Mark rule.** "Marca de Today: la entrada con `episode == episodesWatched + 1` y `long: true`. Si `episodesWatched` es fraccionario, no hay siguiente episodio y no hay marca." Mobile computes nothing else: `long` is bridge-decided ("puede venir `minutes: 30` con `long: true`").
- **S7 — Card chip.** The card shows the mark as a chip mirroring the desktop: "Ep. 7 · 45 min". *Assumption: placement and copy mirror the desktop chip; the user approved the plan without specifying the design.*
- **S9 — Fail-closed change processing (legacy removal).** User (2026-10-14): "¿Qué se hace con el legacy? Se depreca y se borra. Yo diría que ahorita ya pasamos la parte de deprecación porque ya estamos usando una API bastante estable. Por lo tanto, ¿qué es lo que toca ahorita? Borrar. Y no es solo tu trabajo. Es trabajo de ambos en coordinación." For a single remote change (foreground reconcile and natively staged changes): a known field is applied; an unknown field is dropped and logged; an `update` whose `changed_fields` is empty after normalization writes nothing, is logged, and is still acked. The full-snapshot diff is removed from change processing; it stays only in the foreground full resync. `create`, and an `update` for an anime absent locally, still insert the full snapshot.
- **S8 — Canonical storage form.** TS and Kotlin produce byte-identical serialized `episodes` (entry keys `episode, minutes, long`; `null` for absent) so `deriveChangedFields` does not rewrite rows on every resync. *Decision: a malformed `episodes` value is treated as absent (`null`) instead of failing the whole sync response. An empty array is stored as `null` too (same meaning as absent: no durations), so both writers have one canonical form.*

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S4 | inline | done | `d69d305` (RED 4 failing → GREEN 355/355 infra; repair-twin mutation caught by 3 tests) |
| T2b | S9 | inline | done | `fc43de2` RED 2 failing (empty update rewrote the whole row, nrocapvisto 12→3; unknown field unrecorded) → GREEN 749/749 sync+validation+behaviour; guard mutation caught |
| T2 | S1, S2, S3, S5, S8 (TS) | inline | done | `6aa3b18` RED 17 failing → GREEN 1662/1662; mutations caught: merge `episodes` case (4 tests), canonical key order (1 test) |
| T3 | S1, S3, S8 (Kotlin) | inline | done | `6aa3b18` (shared contract fixtures bind both runners); Kotlin RED contract case → GREEN 318/318 + kover 100% branches; mutation (drop episodes mapping) caught by 5 tests |
| T4 | S6, S7 | inline | done | `4fda749` RED 7 failing → GREEN 289/289 animes+app; mutation `!next?.long`→`!next` caught; the integer guard survived mutation (redundant: N.5+1 never matches an integer episode) and was removed |
| T5 | all | delegated verifier (Risk: item 1 migration, item 3 shared wire contract) | done | S1–S9 met, 0 blockers; parent spot check `tsc` exit 0; advisory 2 fixed (drain result type) |

Route evidence: no Writer trigger (no parallel units launched together, no context backstop) — the parent writes inline.

## Log

- **L1 (2026-10-14, user, verbatim):** "Te lo apruebo como ODD" — approving: "Columna `episodes` con su migración y su paso de reparación. Traducción del campo desde el formato de Bridge. Regla de la marca. Resincronización completa al actualizar, para que lleguen las duraciones de los animes que no cambien. Mostrar la marca en la tarjeta."
- **L2 (2026-10-14):** Contract source: bridge `docs/openapi.yaml` on `feat/episode-durations` @ f436964d. Bridge owns the changelog invariant (current snapshot read in the insert tx; ts = max(now, last+1); no non-delete row for a missing anime) that protects already-installed mobile builds; mobile needs no change for it.
- **L3 (2026-10-14):** Mapping found the Kotlin `ReconcileResponseParser` lists snapshot fields explicitly (`LOCAL_FIELD_BY_WIRE_FIELD`, `mapToLegacy`) — without T3, background-staged changes would drop `episodes`. No upgrade-time resync is needed: `useForegroundResync` runs `resyncFromBridgeSnapshot` on mount and on foreground, which fills the new column via `deriveChangedFields` (S5 covered by T2).
- **L4 (2026-10-14):** `0c22ed1` pins the clock in `use-settings-screen.test.ts`, a pre-existing date-dependent failure on `main` that blocked every commit (out of scope, separate commit).
- **L5 (2026-10-14):** The first T1 commit hung 38 min: the Gradle daemon spawned by `test:kotlin` inherited lefthook's stdout and kept it open after the build. The retry used `GRADLE_OPTS=-Dorg.gradle.daemon=false` and finished in 49 s. This is a gate defect to fix separately.
- **L6 (2026-10-14):** Origin of the legacy path: `62631d4` (2026-06-21) added the full diff because the bridge watcher (`snapshot.go`) and `writer.go` never populated `changed_fields`. Bridge confirmed that the watcher was removed in SDD-55, that all production writes compute `changed_fields`, and that `ChangelogStore.InsertPending` now refuses an `update`/`create` with an empty list. The real changelog holds 0 rows. Release order: bridge first, then mobile.
- **L7 (2026-10-14):** T2b records rejections as diagnostic event `remote_change_rejected` (`source: sync_cycle`, `cause: null`); Kotlin logs dropped names to logcat. Bridge's `recentEventTypes` is a closed list and also lacks the already-shipped `native_module_unavailable` (every report carrying it gets 400 today); bridge adds both, pending user approval. Mobile must not release before bridge accepts `remote_change_rejected`. Out of scope, noted: `ReconcileConfirmation` confirms outbox ops by snapshot evidence when a field is absent from `changed_fields` — a separate heuristic on the confirmation path, not on apply.
- **L8 (2026-10-14):** Bridge `33db8f7e` (feat/episode-durations, not pushed) adds `native_module_unavailable` and `remote_change_rejected` to `recentEventTypes` (vocabulary.go), with a test and openapi; verified in the bridge repo. The changelog fix (current snapshot, increasing ts, no empty lists) is still pending its own commit.
- **L9 (2026-10-14):** T2 adds `EpisodeLengthSchema` (`.catch(null)` on the array), `serializeEpisodeLengths`/`parseStoredEpisodeLengths` (`anime-episodes.helpers.ts`), `episodes` in the wire map, `MERGEABLE_FIELDS`, `upsertAnime`, `parseAnimeRow` and the mutation reader. Local mutations never rewrite the full row (only sync paths call `upsertAnime`), and no outbound payload serializes the full `Anime`, so bridge's strict decode is unaffected.
- **L10 (2026-10-14):** S8 correction: the native engine never writes `animes` itself; it stages the legacy snapshot JSON and the JS drain writes the column through `serializeEpisodeLengths`. So Kotlin's job is the domain shape, not the stored text: `mapEpisodes` rebuilds entries with keys `episode, minutes, long` and maps any malformed value to `null`, mirroring `EpisodeLengthSchema.catch(null)`. The shared fixtures (`reconcile-response-cases.json`, `reconcile-response-divergence-cases.json`) now pin `episodes`, with a new case `episodes-mapped-whole-or-null`.
- **L11 (2026-10-14):** T4: `getLongEpisodeLabel` in `anime-card.helpers.ts`, threaded through `useAnimeCard` → `AnimeCard` → `AnimeCardContent` → `AnimeCardInfo`, rendered as a HeroUI `Chip` (`warning`, `sm`, `secondary`) under the progress meta. The list's live query selects every column and `parseAnimeRow` carries `episodes`, so no list change was needed.
- **L12 (2026-10-14):** Bridge `a64a7bc5` (local, not pushed) records every changelog row in one tx with the current snapshot, a per-anime rising ts, no create/update for a missing anime, and no empty `changed_fields`; their independent verifier passed. Documented limit: the per-anime clock only sees rows still in the changelog, so after pruning the next ts restarts from the wall clock. Mobile consequence: if ties had pushed the clock ahead of wall time, the next change can be `<=` the device guard and is dropped as stale until the foreground resync heals the row. Raised with bridge.
- **Release gate:** do NOT release the mobile build that rejects empty lists until bridge confirms a RELEASED bridge build containing `33db8f7e` and `a64a7bc5` (bridge's correction: "Bridge primero" means published, not committed).
- **L13 (2026-10-14):** T5 verifier: S1–S9 met, no blockers. It replayed the real `.sql` files and journal through the ledger pin + migrator + repair in scratch SQLite: a fresh install and a provisioned device both converge and rerun cleanly. Advisories:
  (1) an all-unknown update on an existing row records `remote_change_rejected` twice (inflates a counter only; left as is);
  (2) `DrainPendingRemoteChangesResult` lacked `rejected` (FIXED, RED→GREEN);
  (3) integers beyond the safe range: zod rejects, Kotlin saturates (out of contract domain);
  (4) rows staged by an older build with empty `changed_fields` are now rejected on upgrade (intended by S9);
  (5) its `test:kotlin` run was mostly cached.
- **Next:** wait for the bridge release, then local merge into `dev` (user decision).
